/**
 * ==============================================================================
 * HỆ THỐNG BẤT ĐỘNG SẢN: HỒNG CHÂU - NHÀ ƯNG Ý
 * MODULE 2: GOOGLE APPS SCRIPT BACKEND (Code.gs)
 * ==============================================================================
 * Mục đích:
 * 1. Tiếp nhận đơn đăng ký tư vấn từ trang Blogger Hồng Châu -> Ghi vào tab `DS KHÁCH HÀNG`.
 * 2. Cung cấp API GET bảo mật (API Key) để script Python đọc danh sách khách so khớp.
 * 3. Tự động lưu trữ và đồng bộ kho tin vào tab `DATA_NHA`.
 * ==============================================================================
 */

// CẤU HÌNH HỆ THỐNG
var CONFIG = {
  // ID file Google Sheet của bạn (lấy từ URL Google Sheet)
  SPREADSHEET_ID: "1wRZnlRKqBrGdI3yJjx1FNg3AdcdNPbRHRCATS2-95UA",

  // Tên tab lưu trữ danh sách khách hàng CRM thực tế trong Sheet của bạn
  CUSTOMER_SHEET_NAME: "DS KHÁCH HÀNG",
  
  // Tên tab lưu trữ dữ liệu các căn nhà được đồng bộ tự động từ scraper
  DATA_NHA_SHEET_NAME: "DATA_NHA",

  // Tên tab lưu trữ danh sách gợi ý khách hàng phù hợp
  MATCHES_SHEET_NAME: "GOI_Y_KHACH",

  // Tên tab lưu trữ thống kê truy cập trang web
  STATS_SHEET_NAME: "THONG_KE_TRUY_CAP",

  // Danh sách các tab nguồn để quét căn đã cọc / đã bán
  SOURCE_SHEETS: [
    "BDS TMT-TTH-3.5-6TY",
    "NHÀ GÒ VẤP 5-7TY",
    "BDS 3.5-5 TỶ",
    "NHÀ AHT + THÔNG TÂY HỘI GV (châu)"
  ],
  
  // Khóa bí mật API bảo vệ dữ liệu khách hàng khi gọi từ bên ngoài
  SECRET_API_KEY: "HongChauNhaUngY2026",
  
  // Số điện thoại / Zalo môi giới
  BROKER_PHONE: "0783515486"
};

/**
 * Hàm lấy đối tượng Spreadsheet an toàn (hỗ trợ cả script gắn liền và script độc lập)
 */
function getSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    try {
      ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    } catch (err) {
      Logger.log("Không thể mở bảng tính bằng ID: " + err);
    }
  }
  return ss;
}

/**
 * Endpoint POST: Tiếp nhận yêu cầu tư vấn từ Blogger hoặc đồng bộ kho nhà từ Python
 */
function doPost(e) {
  try {
    var rawData = e.postData ? e.postData.contents : "";
    var data = {};
    
    if (rawData) {
      try {
        data = JSON.parse(rawData);
      } catch (err) {
        data = e.parameter || {};
      }
    } else {
      data = e.parameter || {};
    }

    var action = data.action || "";

    // TRƯỜNG HỢP 1: Đồng bộ kho nhà từ script Python (action = "sync_listings")
    if (action === "sync_listings") {
      if (data.api_key !== CONFIG.SECRET_API_KEY) {
        return createJsonResponse({ status: "error", message: "Sai mã API_KEY bí mật!" }, 403);
      }
      var count = syncListingsToSheet(data.listings || []);
      return createJsonResponse({ status: "success", message: "Đã đồng bộ thành công " + count + " căn nhà vào tab DATA_NHA" });
    }

    // TRƯỜNG HỢP 2: Đồng bộ gợi ý khách hàng từ script Python (action = "sync_matches")
    if (action === "sync_matches") {
      if (data.api_key !== CONFIG.SECRET_API_KEY) {
        return createJsonResponse({ status: "error", message: "Sai mã API_KEY bí mật!" }, 403);
      }
      var matchCount = syncMatchesToSheet(data.matches || []);
      return createJsonResponse({ status: "success", message: "Đã đồng bộ thành công " + matchCount + " gợi ý khách vào tab GOI_Y_KHACH" });
    }

    // TRƯỜNG HỢP 3: Ghi nhận lượt truy cập / mở form từ Blogger (action = "track_view")
    if (action === "track_view") {
      var trackRes = recordTrafficView(data);
      return createJsonResponse(trackRes);
    }

    // TRƯỜNG HỢP 4: Khách hàng gửi đơn tư vấn từ Blogger (Mặc định)
    var result = saveConsultationLead(data);
    return createJsonResponse(result);

  } catch (error) {
    return createJsonResponse({
      status: "error",
      message: "Lỗi xử lý server Apps Script: " + error.toString()
    });
  }
}

/**
 * Endpoint GET: Cho phép script Python đọc danh sách khách hàng hoặc Blogger đọc danh sách nhà
 */
function doGet(e) {
  try {
    var params = e ? e.parameter : {};
    var action = params.action || "";

    // 1. Script Python gọi lấy danh sách khách hàng CRM để so khớp
    if (action === "get_clients") {
      if (params.api_key !== CONFIG.SECRET_API_KEY) {
        return createJsonResponse({ status: "error", message: "Không được phép truy cập (Sai API_KEY)!" }, 403);
      }
      var clients = getCustomersFromSheet();
      return createJsonResponse({ status: "success", total: clients.length, clients: clients });
    }

    // 2. Lấy dữ liệu kho nhà từ tab DATA_NHA (Dự phòng cho Blogger khi GitHub Pages chậm)
    if (action === "get_listings") {
      var listings = getListingsFromSheet();
      return createJsonResponse({ status: "success", total: listings.length, listings: listings });
    }

    // 3. Cho phép ghi nhận lượt xem qua GET nếu client không gửi được POST
    if (action === "track_view") {
      var trackResGet = recordTrafficView(params);
      return createJsonResponse(trackResGet);
    }

    // 4. Lấy báo cáo thống kê truy cập hàng ngày cho script Python gửi Telegram
    if (action === "get_traffic_report") {
      if (params.api_key !== CONFIG.SECRET_API_KEY) {
        return createJsonResponse({ status: "error", message: "Không được phép truy cập (Sai API_KEY)!" }, 403);
      }
      var trafficReport = getTrafficReportFromSheet();
      return createJsonResponse({ status: "success", report: trafficReport });
    }

    // Kiểm tra trạng thái server (Ping test)
    return createJsonResponse({
      status: "ok",
      app: "Hồng Châu - Nhà Ưng Ý CRM & Real Estate Web App",
      time: Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss")
    });

  } catch (error) {
    return createJsonResponse({ status: "error", message: error.toString() });
  }
}

/**
 * Xử lý lưu đơn tư vấn từ khách hàng vào tab `DS KHÁCH HÀNG`
 */
function saveConsultationLead(payload) {
  var ss = getSpreadsheet();
  if (!ss) {
    throw new Error("Không tìm thấy bảng tính Google Sheet với ID: " + CONFIG.SPREADSHEET_ID);
  }

  var sheet = ss.getSheetByName(CONFIG.CUSTOMER_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.CUSTOMER_SHEET_NAME);
  }

  // Đọc hàng tiêu đề (Row 1) để map đúng cột dù thứ tự các cột có thay đổi
  var lastRow = sheet.getLastRow();
  var headers = [];
  if (lastRow >= 1) {
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  } else {
    // Nếu sheet còn trống, tạo bộ tiêu đề chuẩn mẫu thực tế của bạn
    headers = [
      "STT", "Tên liên lạc", "Kênh liên lạc", "Yêu cầu của KH", "Phân loại",
      "Số điện thoại", "Kênh đăng tin dẫn KH", "Hành động ", "Sản phẩm khách liên lạc hỏi",
      "Nhu cầu phát sinh thêm", "Tương tác cuối", "Giai đoạn gần nhất", "Số SP đã gửi", "Số SP đã xem"
    ];
    sheet.appendRow(headers);
    lastRow = 1;
  }

  // Tìm vị trí các cột quan trọng
  var nameColIdx = 1;   // Cột B (index 1)
  var phoneColIdx = 5;  // Cột F (index 5)
  var sttColIdx = 0;    // Cột A (index 0)

  for (var c = 0; c < headers.length; c++) {
    var h = headers[c].toString().toLowerCase().trim();
    if (h.indexOf("tên liên lạc") !== -1 || h === "tên") nameColIdx = c;
    if (h.indexOf("số điện thoại") !== -1 || h.indexOf("sđt") !== -1 || h.indexOf("điện thoại") !== -1) phoneColIdx = c;
    if (h === "stt") sttColIdx = c;
  }

  // Quét từ hàng 2 trở xuống để tìm hàng cuối cùng thực sự có dữ liệu khách hàng
  var lastRealRow = 1; // Mặc định hàng 1 là tiêu đề
  var lastRealSTT = 0;

  if (lastRow > 1) {
    var numRowsToScan = lastRow - 1;
    var values = sheet.getRange(2, 1, numRowsToScan, headers.length).getValues();

    for (var r = 0; r < values.length; r++) {
      var currentRowNum = r + 2; // Số thứ tự hàng thực tế trong Sheet
      var row = values[r];
      var nameVal = (nameColIdx >= 0 && row[nameColIdx] !== undefined) ? row[nameColIdx].toString().trim() : "";
      var phoneVal = (phoneColIdx >= 0 && row[phoneColIdx] !== undefined) ? row[phoneColIdx].toString().trim() : "";

      // Một hàng được coi là có khách thực sự khi Cột B (Tên) HOẶC Cột F (SĐT) không trống
      if (nameVal !== "" || phoneVal !== "") {
        lastRealRow = currentRowNum;
        var sttVal = parseInt(row[sttColIdx]);
        if (!isNaN(sttVal)) {
          lastRealSTT = sttVal;
        }
      }
    }
  }

  // Xác định dòng ghi tiếp theo và STT mới
  var targetRow = lastRealRow + 1;
  var nextSTT = (lastRealSTT > 0) ? (lastRealSTT + 1) : (targetRow - 1);
  if (nextSTT < 1) nextSTT = 1;

  // Chuẩn bị dữ liệu khách hàng
  var clientName = (payload.name || payload.client_name || "Khách ghé Web Blogger").toString().trim();
  var clientPhone = (payload.phone || payload.client_phone || "").toString().trim();
  var clientNote = (payload.note || payload.requirement || "Cần tư vấn chọn căn ưng ý").toString().trim();
  var selectedHomes = payload.selected_homes || payload.cart_items || [];
  
  // Tổng hợp sản phẩm khách hỏi
  var productDetails = [];
  for (var i = 0; i < selectedHomes.length; i++) {
    var h = selectedHomes[i];
    productDetails.push("[" + (h.id || "") + "] " + (h.title || "") + " - " + (h.price || h.price_text || "") + " (" + (h.url || "") + ")");
  }
  var productsString = productDetails.length > 0 ? productDetails.join("\n") : "Khách để lại thông tin chung";

  var nowStr = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm");

  // Map dữ liệu vào các cột theo tên tiêu đề
  var rowData = new Array(headers.length).fill("");

  function setColValue(keywordList, value) {
    for (var colIdx = 0; colIdx < headers.length; colIdx++) {
      var hName = headers[colIdx].toString().toLowerCase().trim();
      for (var k = 0; k < keywordList.length; k++) {
        if (hName.indexOf(keywordList[k].toLowerCase()) !== -1) {
          rowData[colIdx] = value;
          return;
        }
      }
    }
  }

  // Gán giá trị vào đúng cột
  setColValue(["stt"], nextSTT);
  setColValue(["tên liên lạc", "tên"], clientName);
  setColValue(["kênh liên lạc"], "Web Blogger");
  setColValue(["yêu cầu của kh", "yêu cầu"], clientNote);
  setColValue(["phân loại"], "Tệp Web Mới");
  setColValue(["số điện thoại", "sđt", "điện thoại"], "'" + clientPhone); // Thêm dấu ' để không mất số 0 đầu
  setColValue(["kênh đăng tin"], "Blogger Hồng Châu - Nhà Ưng Ý");
  setColValue(["hành động"], "Cần liên hệ tư vấn giỏ hàng");
  setColValue(["sản phẩm khách liên lạc hỏi", "sản phẩm"], productsString);
  setColValue(["nhu cầu phát sinh"], "Đăng ký từ Giỏ Tư Vấn");
  setColValue(["tương tác cuối"], nowStr);
  setColValue(["giai đoạn gần nhất", "giai đoạn"], "Mới tiếp nhận");
  setColValue(["số sp đã gửi"], selectedHomes.length);
  setColValue(["số sp đã xem"], selectedHomes.length);

  // Đảm bảo bảng tính có đủ số dòng nếu targetRow vượt quá số dòng hiện tại
  if (targetRow > sheet.getMaxRows()) {
    sheet.insertRowAfter(sheet.getMaxRows());
  }

  // Ghi trực tiếp vào dòng targetRow (giữ nguyên định dạng, dropdown có sẵn của hàng đó)
  sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);

  return {
    status: "success",
    message: "Đã lưu yêu cầu tư vấn thành công!",
    stt: nextSTT,
    row: targetRow,
    name: clientName,
    time: nowStr
  };
}

/**
 * Đọc toàn bộ danh sách khách hàng CRM từ tab `DS KHÁCH HÀNG`
 */
function getCustomersFromSheet() {
  var ss = getSpreadsheet();
  if (!ss) return [];

  var sheet = ss.getSheetByName(CONFIG.CUSTOMER_SHEET_NAME);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  var headers = data[0];
  var clients = [];

  function getIdx(keywords) {
    for (var i = 0; i < headers.length; i++) {
      var h = headers[i].toString().toLowerCase();
      for (var k = 0; k < keywords.length; k++) {
        if (h.indexOf(keywords[k].toLowerCase()) !== -1) return i;
      }
    }
    return -1;
  }

  var nameIdx = getIdx(["tên liên lạc", "tên"]);
  var reqIdx = getIdx(["yêu cầu của kh", "yêu cầu"]);
  var phoneIdx = getIdx(["số điện thoại", "sđt"]);
  var channelIdx = getIdx(["kênh liên lạc"]);
  var statusIdx = getIdx(["hành động", "giai đoạn"]);

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var name = nameIdx !== -1 ? row[nameIdx].toString().trim() : "";
    var req = reqIdx !== -1 ? row[reqIdx].toString().trim() : "";
    var phone = phoneIdx !== -1 ? row[phoneIdx].toString().trim() : "";
    var channel = channelIdx !== -1 ? row[channelIdx].toString().trim() : "";
    var status = statusIdx !== -1 ? row[statusIdx].toString().trim() : "";

    if (name && status.indexOf("Ngừng liên lạc") === -1) {
      clients.push({
        name: name,
        requirement: req,
        phone: phone,
        channel: channel,
        status: status
      });
    }
  }
  return clients;
}

/**
 * Trích xuất danh sách mã sản phẩm các căn đã cọc / đã bán từ các tab nguồn
 */
function getSoldSignaturesFromSourceSheets() {
  var ss = getSpreadsheet();
  if (!ss) return [];

  var SOURCE_SHEETS = CONFIG.SOURCE_SHEETS || [
    "BDS TMT-TTH-3.5-6TY",
    "NHÀ GÒ VẤP 5-7TY",
    "BDS 3.5-5 TỶ",
    "NHÀ AHT + THÔNG TÂY HỘI GV (châu)"
  ];
  var soldCodes = {};

  for (var s = 0; s < SOURCE_SHEETS.length; s++) {
    var sheetName = SOURCE_SHEETS[s];
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) continue;

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) continue;

    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      // Cột D (index 3): TÍNH CHẤT NHÀ
      var nature = row[3] ? row[3].toString().toLowerCase().trim() : "";
      var isSoldNature = nature.indexOf("đã cọc") !== -1 ||
                         nature.indexOf("đã bán") !== -1 ||
                         nature.indexOf("da coc") !== -1 ||
                         nature.indexOf("da ban") !== -1;

      if (isSoldNature) {
        var code = row[5] ? row[5].toString().trim().toUpperCase() : ""; // Cột F: MÃ SP QUẢN LÝ
        if (code) {
          soldCodes[code] = true;
        }
      }
    }
  }
  return Object.keys(soldCodes);
}

/**
 * Kiểm tra xem 1 tin đăng có khớp với danh sách căn đã cọc/đã bán không
 * CHỈ đối chiếu 100% theo Mã SP (internal_code) hoặc chọn tay trên tab DATA_NHA
 */
function checkIfListingSold(item, soldCodes) {
  if (!item) return false;

  var statusText = (item.status || "").toString().toLowerCase();
  if (item.is_sold === true || statusText.indexOf("đã bán") !== -1 || statusText.indexOf("đã cọc") !== -1 || statusText.indexOf("da ban") !== -1) {
    return true;
  }

  if (!soldCodes || soldCodes.length === 0) return false;

  var internalCode = (item.internal_code || "").toString().trim().toUpperCase();
  var itemId = (item.id || "").toString().trim().toUpperCase();

  for (var i = 0; i < soldCodes.length; i++) {
    var sc = soldCodes[i];
    if (internalCode && sc === internalCode) {
      return true;
    }
    if (itemId && sc === itemId) {
      return true;
    }
  }

  return false;
}

/**
 * Lưu toàn bộ danh sách căn nhà vào tab `DATA_NHA`
 * BẢO TOÀN toàn bộ chỉnh sửa tay của người dùng ở các cột Mục Đích, Phân Loại Dòng Tiền, Trạng Thái
 */
function syncListingsToSheet(listings) {
  if (!listings || listings.length === 0) return 0;
  
  var ss = getSpreadsheet();
  if (!ss) return 0;

  var sheet = ss.getSheetByName(CONFIG.DATA_NHA_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.DATA_NHA_SHEET_NAME);
  }
  
  // 1. Đọc dữ liệu chỉnh sửa tay hiện có trên tab DATA_NHA để BẢO TOÀN
  var existingMap = {};
  var oldData = sheet.getDataRange().getValues();
  if (oldData.length > 1) {
    for (var o = 1; o < oldData.length; o++) {
      var oRow = oldData[o];
      var oId = oRow[0] ? oRow[0].toString().trim() : "";
      if (oId) {
        existingMap[oId] = {
          purposes: oRow[14] ? oRow[14].toString().trim() : "",
          cashflow_subtype: oRow[15] ? oRow[15].toString().trim() : "",
          status: oRow[18] ? oRow[18].toString().trim() : "",
          internal_code: oRow[19] ? oRow[19].toString().trim() : ""
        };
      }
    }
  }

  sheet.clearContents();

  var headers = [
    "Mã Tin", "Tiêu Đề", "Mức Giá (Tỷ)", "Giá Gốc", "Giảm Chào", "Giá Cũ (Tỷ)",
    "Diện Tích (m²)", "Số PN", "Hẻm / Đường", "Phường / Xã", "Quận", "Link Tin Gốc",
    "Ảnh Đại Diện", "Mô Tả Ngắn", "Mục Đích", "Phân Loại Dòng Tiền", "Thu Nhập Thuê", "Cập Nhật Lúc", "Trạng Thái", "Mã SP"
  ];
  sheet.appendRow(headers);

  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground("#059669").setFontColor("#FFFFFF").setFontWeight("bold");

  var soldCodes = getSoldSignaturesFromSourceSheets();
  var rows = [];

  for (var i = 0; i < listings.length; i++) {
    var item = listings[i];
    var itemId = item.id || "";
    var existing = existingMap[itemId] || null;

    // Bảo toàn chỉnh sửa tay từ Sheet nếu đã có
    var purposesStr = "";
    if (existing && existing.purposes) {
      purposesStr = existing.purposes;
    } else {
      purposesStr = Array.isArray(item.purposes) ? item.purposes.join(",") : (item.purposes || "");
    }

    var cashflowSubtype = "";
    if (existing && existing.cashflow_subtype !== undefined && existing.cashflow_subtype !== "") {
      cashflowSubtype = existing.cashflow_subtype;
    } else {
      cashflowSubtype = item.cashflow_subtype || "";
    }

    var internalCode = (item.internal_code || (existing ? existing.internal_code : "") || "").toString().trim().toUpperCase();

    // Đối chiếu trạng thái đã bán
    var isSold = false;
    var statusDisplay = "Đang bán";

    if (existing && existing.status) {
      statusDisplay = existing.status;
      if (statusDisplay.indexOf("Đã bán") !== -1 || statusDisplay.indexOf("Đã cọc") !== -1) {
        isSold = true;
      }
    } else {
      isSold = checkIfListingSold({
        id: itemId,
        internal_code: internalCode,
        status: item.status,
        is_sold: item.is_sold
      }, soldCodes);
      statusDisplay = isSold ? "🚫 Đã bán" : (item.status && item.status.indexOf("sold") !== -1 ? "🚫 Đã bán" : "Đang bán");
    }

    rows.push([
      itemId,
      item.title || "",
      item.price_ty || 0,
      item.price_text || "",
      item.is_price_dropped ? "🔥 GIẢM CHÀO (-" + Math.round((item.drop_amount_ty || 0) * 1000) + "Tr)" : "Bình thường",
      item.old_price_ty || "",
      item.area_m2 || 0,
      item.bedrooms || 0,
      item.alley_type || "",
      item.ward || "",
      item.district || "",
      item.url || "",
      item.image || "",
      item.description || "",
      purposesStr,
      cashflowSubtype,
      item.estimated_rent_text || "",
      item.last_checked_at || item.updated_at || "",
      statusDisplay,
      internalCode
    ]);
  }

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);

    // Thiết lập Data Validation (Dropdown) cho Cột 15, 16, 19
    var totalDataRows = Math.max(rows.length, 50);

    // Cột 15: Mục Đích (cho phép chọn hoặc nhập kết hợp)
    var rulePurposes = SpreadsheetApp.newDataValidation()
      .requireValueInList(["de_o", "dong_tien", "kinh_doanh", "dat", "de_o, kinh_doanh", "de_o, dong_tien", "dong_tien, kinh_doanh", "de_o, dong_tien, kinh_doanh"], true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, 15, totalDataRows, 1).setDataValidation(rulePurposes);

    // Cột 16: Phân Loại Dòng Tiền
    var ruleCashflow = SpreadsheetApp.newDataValidation()
      .requireValueInList(["", "day_tro", "chdv", "tiem_nang_chdv"], true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, 16, totalDataRows, 1).setDataValidation(ruleCashflow);

    // Cột 19: Trạng Thái
    var ruleStatus = SpreadsheetApp.newDataValidation()
      .requireValueInList(["Đang bán", "🚫 Đã bán"], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(2, 19, totalDataRows, 1).setDataValidation(ruleStatus);
  }

  return rows.length;
}

/**
 * Đọc danh sách căn nhà từ tab `DATA_NHA` trả về dạng mảng Object
 */
function getListingsFromSheet() {
  var ss = getSpreadsheet();
  if (!ss) return [];

  var sheet = ss.getSheetByName(CONFIG.DATA_NHA_SHEET_NAME);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  var soldCodes = getSoldSignaturesFromSourceSheets();
  var listings = [];

  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var itemId = r[0] ? r[0].toString().trim() : "";
    if (!itemId) continue;

    var pStr = r[14] ? r[14].toString().trim() : "";
    var pArr = pStr ? pStr.split(",").map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; }) : [];
    var statusVal = r[18] ? r[18].toString().trim() : "";
    var internalCode = r[19] ? r[19].toString().trim().toUpperCase() : "";

    var isSold = statusVal.indexOf("Đã bán") !== -1 || statusVal.indexOf("Đã cọc") !== -1;

    var itemObj = {
      id: itemId,
      title: r[1],
      price_ty: parseFloat(r[2]) || 0,
      price_text: r[3],
      is_price_dropped: r[4].toString().indexOf("GIẢM") !== -1,
      old_price_ty: parseFloat(r[5]) || null,
      area_m2: parseFloat(r[6]) || 0,
      bedrooms: parseInt(r[7]) || 0,
      alley_type: r[8],
      ward: r[9],
      district: r[10],
      url: r[11],
      image: r[12],
      description: r[13],
      purposes: pArr,
      cashflow_subtype: r[15] ? r[15].toString().trim() : "",
      estimated_rent_text: r[16] || "",
      updated_at: r[17] || "",
      status: statusVal || "Đang bán",
      internal_code: internalCode
    };

    if (!isSold) {
      isSold = checkIfListingSold(itemObj, soldCodes);
      if (isSold) {
        itemObj.status = "🚫 Đã bán";
        try {
          sheet.getRange(i + 1, 19).setValue("🚫 Đã bán");
        } catch (err) {}
      }
    }

    itemObj.is_sold = isSold;
    listings.push(itemObj);
  }
  return listings;
}

/**
 * Lưu toàn bộ gợi ý khách hàng vào tab `GOI_Y_KHACH`
 */
function syncMatchesToSheet(matches) {
  if (!matches || matches.length === 0) return 0;

  var ss = getSpreadsheet();
  if (!ss) return 0;

  var sheet = ss.getSheetByName(CONFIG.MATCHES_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.MATCHES_SHEET_NAME);
  }

  var lastRow = sheet.getLastRow();
  var headers = [
    "Thời Gian", "Mã Tin", "Tên Căn Nhà", "Giá", "Tên Khách",
    "SĐT / Zalo", "Độ Khớp (%)", "Mẫu Tin Nhắn Gửi Khách", "Trạng Thái"
  ];

  if (lastRow === 0) {
    sheet.appendRow(headers);
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground("#059669").setFontColor("#FFFFFF").setFontWeight("bold");
    lastRow = 1;
  }

  var nowStr = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm");
  var rows = [];

  for (var i = 0; i < matches.length; i++) {
    var m = matches[i];
    var phoneStr = (m.client_phone || m.phone || "").toString().trim();
    if (phoneStr && !phoneStr.startsWith("'")) {
      phoneStr = "'" + phoneStr;
    }

    rows.push([
      m.time || nowStr,
      m.listing_id || "",
      m.listing_title || "",
      m.price || "",
      m.client_name || "",
      phoneStr,
      m.score || "",
      m.pitch_message || "",
      m.status || "Chưa gửi"
    ]);
  }

  if (rows.length > 0) {
    var startRow = lastRow + 1;
    sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
  }

  return rows.length;
}

/**
 * Ghi nhận lượt xem trang hoặc mở form tư vấn vào tab `THONG_KE_TRUY_CAP`
 */
function recordTrafficView(payload) {
  var ss = getSpreadsheet();
  if (!ss) return { status: "error", message: "Không tìm thấy Sheet" };

  var sheet = ss.getSheetByName(CONFIG.STATS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.STATS_SHEET_NAME);
  }

  var lastRow = sheet.getLastRow();
  var headers = [
    "Ngày (DD/MM/YYYY)",
    "Lượt khách truy cập (Unique Session)",
    "Tổng lượt mở trang",
    "Số khách mở Form tư vấn"
  ];

  if (lastRow === 0) {
    sheet.appendRow(headers);
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground("#059669").setFontColor("#FFFFFF").setFontWeight("bold");
    lastRow = 1;
  }

  var todayStr = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy");
  var isUnique = (payload.is_unique === true || payload.is_unique === "true" || payload.is_unique === 1 || payload.is_unique === "1");
  var evt = payload.event || "page_view";

  // Tìm dòng của ngày hôm nay
  var targetRow = -1;
  if (lastRow > 1) {
    var dates = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < dates.length; i++) {
      var dVal = dates[i][0];
      var dStr = "";
      if (dVal instanceof Date) {
        dStr = Utilities.formatDate(dVal, "Asia/Ho_Chi_Minh", "dd/MM/yyyy");
      } else {
        dStr = dVal ? dVal.toString().trim() : "";
      }
      if (dStr === todayStr) {
        targetRow = i + 2;
        break;
      }
    }
  }

  // Nếu chưa có dòng ngày hôm nay, tạo dòng mới với các số liệu ban đầu là 0
  if (targetRow === -1) {
    sheet.appendRow([todayStr, 0, 0, 0]);
    targetRow = sheet.getLastRow();
  }

  // Đọc các giá trị hiện tại của ngày hôm nay
  var currentValues = sheet.getRange(targetRow, 2, 1, 3).getValues()[0];
  var uniqueCount = parseInt(currentValues[0]) || 0;
  var pageviewCount = parseInt(currentValues[1]) || 0;
  var drawerCount = parseInt(currentValues[2]) || 0;

  if (evt === "open_drawer" && isUnique) {
    drawerCount += 1;
  } else {
    // Mặc định là page_view
    pageviewCount += 1;
    if (isUnique) {
      uniqueCount += 1;
    }
  }

  sheet.getRange(targetRow, 2, 1, 3).setValues([[uniqueCount, pageviewCount, drawerCount]]);

  return {
    status: "success",
    date: todayStr,
    unique: uniqueCount,
    pageviews: pageviewCount,
    drawer_opens: drawerCount
  };
}

/**
 * Đọc dữ liệu thống kê từ tab `THONG_KE_TRUY_CAP`
 */
function getTrafficReportFromSheet() {
  var ss = getSpreadsheet();
  var emptyReport = {
    today_views: 0,
    today_pageviews: 0,
    yesterday_views: 0,
    total_views: 0,
    today_drawer_opens: 0
  };
  if (!ss) return emptyReport;

  var sheet = ss.getSheetByName(CONFIG.STATS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) return emptyReport;

  var data = sheet.getDataRange().getValues();
  var todayStr = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy");
  var yDate = new Date();
  yDate.setDate(yDate.getDate() - 1);
  var yesterdayStr = Utilities.formatDate(yDate, "Asia/Ho_Chi_Minh", "dd/MM/yyyy");

  var today_views = 0;
  var today_pageviews = 0;
  var yesterday_views = 0;
  var total_views = 0;
  var today_drawer_opens = 0;

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var dVal = row[0];
    var dStr = "";
    if (dVal instanceof Date) {
      dStr = Utilities.formatDate(dVal, "Asia/Ho_Chi_Minh", "dd/MM/yyyy");
    } else {
      dStr = dVal ? dVal.toString().trim() : "";
    }

    var uVal = parseInt(row[1]) || 0;
    var pVal = parseInt(row[2]) || 0;
    var drVal = parseInt(row[3]) || 0;

    total_views += uVal;

    if (dStr === todayStr) {
      today_views = uVal;
      today_pageviews = pVal;
      today_drawer_opens = drVal;
    } else if (dStr === yesterdayStr) {
      yesterday_views = uVal;
    }
  }

  return {
    date: todayStr,
    today_views: today_views,
    today_pageviews: today_pageviews,
    yesterday_views: yesterday_views,
    total_views: total_views,
    today_drawer_opens: today_drawer_opens
  };
}

/**
 * Tạo phản hồi JSON chuẩn hỗ trợ giải quyết bài toán CORS trên trình duyệt
 */
function createJsonResponse(data, statusCode) {
  var output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
