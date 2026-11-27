/**
 * ==============================================================================
 * HỆ THỐNG BẤT ĐỘNG SẢN: HỒNG CHÂU - NHÀ ƯNG Ý
 * MODULE 2: GOOGLE APPS SCRIPT BACKEND (Code.gs)
 * ==============================================================================
 * Mục đích:
 * 1. Tiếp nhận đơn đăng ký tư vấn từ trang Blogger Hồng Châu -> Ghi vào tab `DS KHÁCH HÀNG`.
 * 2. Cung cấp API GET bảo mật (API Key) để script Python đọc danh sách khách so khớp.
 * 3. Tự động lưu trữ và đồng bộ kho tin vào tab `DATA_NHA` (kèm Tiêu Đề Sản Phẩm & Link Website).
 * 4. Xử lý Telegram Webhook 24/7 (/dongbo, /dung, /bat, /thieuma, /khach, /menu).
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

  // Danh sách 7 sheet sản phẩm thực tế để quét "Đã cọc/đã bán", lấy Tiêu đề + Link và đánh dấu "Đã đăng Nhadat247"
  PRODUCT_SHEETS: [
    "BDS TMT-TTH-3.5-6TY",
    "NHÀ GÒ VẤP 5-7TY",
    "BDS 3.5-5 TỶ",
    "BDS DƯỚI 3.5 TỶ",
    "BDS 5-8 TỶ",
    "BDS 8-15 TỶ",
    "BDS 15-25 TỶ"
  ],

  // Danh sách các tab nguồn để quét căn đã cọc / đã bán (đồng bộ với 7 sheet sản phẩm)
  SOURCE_SHEETS: [
    "BDS TMT-TTH-3.5-6TY",
    "NHÀ GÒ VẤP 5-7TY",
    "BDS 3.5-5 TỶ",
    "BDS DƯỚI 3.5 TỶ",
    "BDS 5-8 TỶ",
    "BDS 8-15 TỶ",
    "BDS 15-25 TỶ"
  ],

  // Khóa bí mật API bảo vệ dữ liệu khách hàng khi gọi từ bên ngoài
  SECRET_API_KEY: "HongChauNhaUngY2026",

  // Số điện thoại / Zalo môi giới
  BROKER_PHONE: "0783515486",

  // Cấu hình Telegram Bot Webhook & Chat ID chủ sở hữu
  TELEGRAM_BOT_TOKEN: "9023599834:AAHPZCqknyPCkHfC1XIc24e7SUOLvaiy7CI",
  TELEGRAM_CHAT_ID: "1732042281",

  // Cấu hình GitHub Actions kích hoạt đồng bộ tự động
  GITHUB_REPO: "binhthuynguyen64-dotcom/blog-bat-dong-san",
  GITHUB_WORKFLOW: "daily_sync.yml",

  // Đường dẫn Web App chính thức (/exec) để đăng ký Webhook Telegram chính xác
  WEBAPP_URL: "https://script.google.com/macros/s/AKfycbyA3xWOq72d1H-GVqh9aZ3FXEFLpyKPcJD78KNB2kRp8GeVMeXggC9aCDd3bYAud6u6/exec"
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
 * Endpoint POST: Tiếp nhận yêu cầu tư vấn từ Blogger, Webhook Telegram hoặc đồng bộ kho nhà từ Python
 */
function doPost(e) {
  try {
    var rawData = (e && e.postData && e.postData.contents) ? e.postData.contents : "";
    var data = {};

    if (rawData) {
      try {
        data = JSON.parse(rawData);
      } catch (err) {
        data = (e && e.parameter) ? e.parameter : {};
      }
    } else {
      data = (e && e.parameter) ? e.parameter : {};
    }

    // TRƯỜNG HỢP 0: Telegram Webhook Update từ bot
    if (data.message && data.message.text) {
      return handleTelegramWebhook(data);
    }

    var action = data.action || "";

    // TRƯỜNG HỢP 1: Đồng bộ kho nhà từ script Python (action = "sync_listings")
    if (action === "sync_listings") {
      if (data.api_key !== CONFIG.SECRET_API_KEY) {
        return createJsonResponse({ status: "error", message: "Sai mã API_KEY bí mật!" }, 403);
      }
      var overwritePurposes = Boolean(data.overwrite_purposes);
      var count = syncListingsToSheet(data.listings || [], overwritePurposes);
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

    // TRƯỜNG HỢP 4: Cập nhật trạng thái "Đã đăng Nhadat247" trên 7 sheet sản phẩm
    if (action === "mark_posted_sheets") {
      if (data.api_key !== CONFIG.SECRET_API_KEY) {
        return createJsonResponse({ status: "error", message: "Sai mã API_KEY bí mật!" }, 403);
      }
      var updatedSheets = markPostedNhadat247OnProductSheets(data.posted_codes || null);
      return createJsonResponse({ status: "success", message: "Đã cập nhật cột 'Đã đăng Nhadat247' trên " + updatedSheets + " sheet sản phẩm." });
    }

    // TRƯỜNG HỢP 5: Kiểm tra trạng thái tạm dừng của bot (check_bot_status)
    if (action === "check_bot_status") {
      var botPausedPost = PropertiesService.getScriptProperties().getProperty("BOT_PAUSED") === "true";
      return createJsonResponse({ status: "success", bot_paused: botPausedPost });
    }

    // TRƯỜNG HỢP 6: Khách hàng gửi đơn tư vấn từ Blogger (Mặc định)
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

    // 5. Cho phép kích hoạt đối chiếu & đánh dấu "Đã đăng Nhadat247" trên 7 sheet qua GET
    if (action === "mark_posted_sheets") {
      if (params.api_key !== CONFIG.SECRET_API_KEY) {
        return createJsonResponse({ status: "error", message: "Không được phép truy cập (Sai API_KEY)!" }, 403);
      }
      var updatedSheetsGet = markPostedNhadat247OnProductSheets();
      return createJsonResponse({ status: "success", message: "Đã cập nhật cột 'Đã đăng Nhadat247' trên " + updatedSheetsGet + " sheet sản phẩm." });
    }

    // 6. Kiểm tra trạng thái tạm dừng của bot (check_bot_status)
    if (action === "check_bot_status") {
      var botPausedGet = PropertiesService.getScriptProperties().getProperty("BOT_PAUSED") === "true";
      return createJsonResponse({ status: "success", bot_paused: botPausedGet });
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

  var lastRow = sheet.getLastRow();
  var headers = [];
  if (lastRow >= 1) {
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  } else {
    headers = [
      "STT", "Tên liên lạc", "Kênh liên lạc", "Yêu cầu của KH", "Phân loại",
      "Số điện thoại", "Kênh đăng tin dẫn KH", "Hành động ", "Sản phẩm khách liên lạc hỏi",
      "Nhu cầu phát sinh thêm", "Tương tác cuối", "Giai đoạn gần nhất", "Số SP đã gửi", "Số SP đã xem"
    ];
    sheet.appendRow(headers);
    lastRow = 1;
  }

  var nameColIdx = 1;
  var phoneColIdx = 5;
  var sttColIdx = 0;

  for (var c = 0; c < headers.length; c++) {
    var h = headers[c].toString().toLowerCase().trim();
    if (h.indexOf("tên liên lạc") !== -1 || h === "tên") nameColIdx = c;
    if (h.indexOf("số điện thoại") !== -1 || h.indexOf("sđt") !== -1 || h.indexOf("điện thoại") !== -1) phoneColIdx = c;
    if (h === "stt") sttColIdx = c;
  }

  var lastRealRow = 1;
  var lastRealSTT = 0;

  if (lastRow > 1) {
    var numRowsToScan = lastRow - 1;
    var values = sheet.getRange(2, 1, numRowsToScan, headers.length).getValues();

    for (var r = 0; r < values.length; r++) {
      var currentRowNum = r + 2;
      var row = values[r];
      var nameVal = (nameColIdx >= 0 && row[nameColIdx] !== undefined) ? row[nameColIdx].toString().trim() : "";
      var phoneVal = (phoneColIdx >= 0 && row[phoneColIdx] !== undefined) ? row[phoneColIdx].toString().trim() : "";

      if (nameVal !== "" || phoneVal !== "") {
        lastRealRow = currentRowNum;
        var sttVal = parseInt(row[sttColIdx], 10);
        if (!isNaN(sttVal)) {
          lastRealSTT = sttVal;
        }
      }
    }
  }

  var targetRow = lastRealRow + 1;
  var nextSTT = (lastRealSTT > 0) ? (lastRealSTT + 1) : (targetRow - 1);
  if (nextSTT < 1) nextSTT = 1;

  var clientName = (payload.name || payload.client_name || "Khách ghé Web Blogger").toString().trim();
  var clientPhone = (payload.phone || payload.client_phone || "").toString().trim();
  var clientNote = (payload.note || payload.requirement || "Cần tư vấn chọn căn ưng ý").toString().trim();
  var selectedHomes = payload.selected_homes || payload.cart_items || [];

  var productDetails = [];
  for (var i = 0; i < selectedHomes.length; i++) {
    var h = selectedHomes[i];
    productDetails.push("[" + (h.id || "") + "] " + (h.title || "") + " - " + (h.price || h.price_text || "") + " (" + (h.url || "") + ")");
  }
  var productsString = productDetails.length > 0 ? productDetails.join("\n") : "Khách để lại thông tin chung";

  var nowStr = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm");
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

  setColValue(["stt"], nextSTT);
  setColValue(["tên liên lạc", "tên"], clientName);
  setColValue(["kênh liên lạc"], "Web Blogger");
  setColValue(["yêu cầu của kh", "yêu cầu"], clientNote);
  setColValue(["phân loại"], "Tệp Web Mới");
  setColValue(["số điện thoại", "sđt", "điện thoại"], "'" + clientPhone);
  setColValue(["kênh đăng tin"], "Blogger Hồng Châu - Nhà Ưng Ý");
  setColValue(["hành động"], "Cần liên hệ tư vấn giỏ hàng");
  setColValue(["sản phẩm khách liên lạc hỏi", "sản phẩm"], productsString);
  setColValue(["nhu cầu phát sinh"], "Đăng ký từ Giỏ Tư Vấn");
  setColValue(["tương tác cuối"], nowStr);
  setColValue(["giai đoạn gần nhất", "giai đoạn"], "Mới tiếp nhận");
  setColValue(["số sp đã gửi"], selectedHomes.length);
  setColValue(["số sp đã xem"], selectedHomes.length);

  if (targetRow > sheet.getMaxRows()) {
    sheet.insertRowAfter(sheet.getMaxRows());
  }

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
 * Trích xuất danh sách mã sản phẩm các căn đã cọc / đã bán / dừng bán từ 7 tab nguồn
 * Quét chuẩn xác cột TÍNH CHẤT NHÀ (mặc định Cột E = index 4) và kiểm tra dự phòng các cột B->G
 */
function getSoldSignaturesFromSourceSheets() {
  var ss = getSpreadsheet();
  if (!ss) return [];

  var SOURCE_SHEETS = CONFIG.SOURCE_SHEETS || CONFIG.PRODUCT_SHEETS || [
    "BDS TMT-TTH-3.5-6TY",
    "NHÀ GÒ VẤP 5-7TY",
    "BDS 3.5-5 TỶ",
    "BDS DƯỚI 3.5 TỶ",
    "BDS 5-8 TỶ",
    "BDS 8-15 TỶ",
    "BDS 15-25 TỶ"
  ];
  var soldCodes = {};

  for (var s = 0; s < SOURCE_SHEETS.length; s++) {
    var sheetName = SOURCE_SHEETS[s];
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) continue;

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) continue;

    var header = data[0];
    var natureCol = 4; // Mặc định Cột E (index 4: TÍNH CHẤT NHÀ)
    var codeCol = 5;   // Mặc định Cột F (index 5: MÃ SP QUẢN LÝ)

    for (var h = 0; h < header.length; h++) {
      var hText = (header[h] || "").toString().toLowerCase().replace(/[\r\n\s]+/g, " ").trim();
      if (hText.indexOf("tính chất") !== -1 || hText.indexOf("tinh chat") !== -1) natureCol = h;
      if (hText.indexOf("mã sp") !== -1 || hText.indexOf("ma sp") !== -1) codeCol = h;
    }

    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      var rawCode = (codeCol < row.length && row[codeCol]) ? row[codeCol].toString().trim().toUpperCase() : "";
      var code = rawCode.replace(/\s+/g, "");
      if (!code) continue;

      // Kiểm tra cột TÍNH CHẤT NHÀ và quét dự phòng các cột B -> G (index 1 -> 6)
      var isStoppedOrSold = false;
      var checkCols = [natureCol, 1, 2, 3, 4, 6];
      for (var cIdx = 0; cIdx < checkCols.length; cIdx++) {
        var col = checkCols[cIdx];
        if (col >= 0 && col < row.length && row[col]) {
          var cellLow = row[col].toString().toLowerCase().trim();
          if (cellLow.indexOf("đã cọc") !== -1 ||
              cellLow.indexOf("đã bán") !== -1 ||
              cellLow.indexOf("dừng bán") !== -1 ||
              cellLow.indexOf("da coc") !== -1 ||
              cellLow.indexOf("da ban") !== -1 ||
              cellLow.indexOf("dung ban") !== -1) {
            isStoppedOrSold = true;
            break;
          }
        }
      }

      if (isStoppedOrSold) {
        soldCodes[code] = true;
      }
    }
  }
  return Object.keys(soldCodes);
}

/**
 * Quét các căn CHƯA ĐĂNG trên Nhadat247 từ các sheet nguồn (Bản sửa lỗi triệt để):
 * 1. Bắt buộc cột "ĐI KHẢO SÁT" == "Đi rồi"
 * 2. Loại bỏ tuyệt đối mọi dòng có tag "Đã cọc", "Đã bán", "Dừng bán" (quét Cột E và các cột B->G)
 * 3. Loại bỏ mọi dòng mà cột "Đã đăng Nhadat247" trên sheet nguồn đã đánh dấu "✅ Đã đăng"
 * 4. Đối chiếu chéo toàn diện với danh sách đã đăng (Mã SP + Link PropTech + Độ giống Tiêu Đề >= 78%)
 */
function getUnpostedProductsFromSourceSheets(postedCodesLookup, soldCodes, postedRecords) {
  var ss = getSpreadsheet();
  if (!ss) return [];

  var prioritySheets = [
    "BDS TMT-TTH-3.5-6TY",
    "NHÀ GÒ VẤP 5-7TY",
    "BDS 3.5-5 TỶ"
  ];
  var allSheets = CONFIG.PRODUCT_SHEETS || [];
  var orderedSheets = prioritySheets.slice();
  for (var i = 0; i < allSheets.length; i++) {
    if (orderedSheets.indexOf(allSheets[i]) === -1) {
      orderedSheets.push(allSheets[i]);
    }
  }

  var soldLookup = {};
  if (soldCodes && soldCodes.length > 0) {
    for (var sc = 0; sc < soldCodes.length; sc++) {
      soldLookup[soldCodes[sc]] = true;
    }
  }

  // Xây dựng bộ đối chiếu trùng lặp từ các căn ĐÃ ĐĂNG trên Nhadat247
  var postedLinksLookup = {};
  var comparePool = []; // [{ code, title, normTitle, normLink }]

  if (postedRecords && postedRecords.length > 0) {
    for (var pr = 0; pr < postedRecords.length; pr++) {
      var rec = postedRecords[pr];
      var nLink = normalizePropTechUrl(rec.website_link);
      if (nLink) {
        postedLinksLookup[nLink] = rec.internal_code || "ĐÃ ĐĂNG";
      }
      var nTitle = normalizeProductTitleForCompare(rec.product_title);
      if (nTitle) {
        comparePool.push({
          code: rec.internal_code || "ĐÃ ĐĂNG",
          title: rec.product_title,
          normTitle: nTitle,
          normLink: nLink
        });
      }
    }
  }

  var seenUnpostedCodes = {};
  var cleanResults = [];
  var suspectResults = [];

  for (var s = 0; s < orderedSheets.length; s++) {
    var sheetName = orderedSheets[s];
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) continue;

    var range = sheet.getDataRange();
    var data = range.getValues();
    if (data.length <= 1) continue;

    var richText = null;
    try {
      richText = range.getRichTextValues();
    } catch (eRich) {}

    var header = data[0];
    var surveyCol = 2;     // Mặc định Cột C (index 2: ĐI KHẢO SÁT)
    var natureCol = 4;     // Mặc định Cột E (index 4: TÍNH CHẤT NHÀ)
    var codeCol = 5;       // Mặc định Cột F (index 5: MÃ SP QUẢN LÝ)
    var titleCol = 8;      // Mặc định Cột I (index 8: TIÊU ĐỀ SẢN PHẨM)
    var linkCol = 15;      // Mặc định Cột P (index 15: LINK WEBSITE)
    var priceCol = 17;     // Mặc định Cột R (index 17: GIÁ)
    var dropPriceCol = 18; // Mặc định Cột S (index 18: GIÁ GIẢM CHÀO)
    var postedFlagCol = -1;

    for (var h = 0; h < header.length; h++) {
      var hText = (header[h] || "").toString().toLowerCase().replace(/[\r\n\s]+/g, " ").trim();
      if (hText.indexOf("khảo sát") !== -1 || hText.indexOf("khao sat") !== -1) surveyCol = h;
      if (hText.indexOf("tính chất") !== -1 || hText.indexOf("tinh chat") !== -1) natureCol = h;
      if (hText.indexOf("mã sp") !== -1 || hText.indexOf("ma sp") !== -1) codeCol = h;
      if (hText.indexOf("tiêu đề sản phẩm") !== -1 || hText.indexOf("tieu de san pham") !== -1) titleCol = h;
      if (hText.indexOf("link website") !== -1 || hText.indexOf("link web") !== -1) linkCol = h;
      if (hText === "giá" || hText === "gia") priceCol = h;
      if (hText.indexOf("giá giảm") !== -1 || hText.indexOf("gia giam") !== -1) dropPriceCol = h;
      if (hText.indexOf("đã đăng nhadat247") !== -1 || hText.indexOf("da dang nhadat247") !== -1) postedFlagCol = h;
    }

    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      var rawCode = (codeCol < row.length && row[codeCol]) ? row[codeCol].toString().trim().toUpperCase() : "";
      var normCode = rawCode.replace(/\s+/g, "");
      if (!normCode) continue;

      // 1. Bỏ qua nếu trùng Mã SP đã đăng trên DATA_NHA hoặc đã gom ở sheet ưu tiên phía trên
      if (postedCodesLookup[normCode] || seenUnpostedCodes[normCode]) continue;

      // 2. Bỏ qua nếu cột "Đã đăng Nhadat247" trên chính sheet nguồn này đã đánh dấu Đã đăng
      if (postedFlagCol >= 0 && postedFlagCol < row.length && row[postedFlagCol]) {
        var flagText = row[postedFlagCol].toString().toLowerCase().trim();
        if (flagText.indexOf("đã đăng") !== -1 || flagText.indexOf("da dang") !== -1) {
          continue;
        }
      }

      // 3. Bắt buộc cột "ĐI KHẢO SÁT" phải là "Đi rồi"
      var surveyStatus = (surveyCol < row.length && row[surveyCol]) ? row[surveyCol].toString().toLowerCase().trim() : "";
      if (surveyStatus !== "đi rồi" && surveyStatus !== "di roi") continue;

      // 4. Loại bỏ tuyệt đối mọi dòng có tag "Đã cọc", "Đã bán", "Dừng bán" (kiểm tra Cột E và dự phòng B->G)
      var isInvalidNature = Boolean(soldLookup[normCode]);
      if (!isInvalidNature) {
        var checkCols = [natureCol, 1, 2, 3, 4, 6];
        for (var cIdx = 0; cIdx < checkCols.length; cIdx++) {
          var col = checkCols[cIdx];
          if (col >= 0 && col < row.length && row[col]) {
            var cellLow = row[col].toString().toLowerCase().trim();
            if (cellLow.indexOf("đã cọc") !== -1 ||
                cellLow.indexOf("đã bán") !== -1 ||
                cellLow.indexOf("dừng bán") !== -1 ||
                cellLow.indexOf("da coc") !== -1 ||
                cellLow.indexOf("da ban") !== -1 ||
                cellLow.indexOf("dung ban") !== -1) {
              isInvalidNature = true;
              break;
            }
          }
        }
      }
      if (isInvalidNature) continue;

      var titleVal = (titleCol < row.length && row[titleCol] !== null && row[titleCol] !== undefined)
        ? row[titleCol].toString().trim()
        : "";
      if (!titleVal) continue;

      // Lấy Link Website (ưu tiên link proptech.thienkhoi.com)
      var linkVal = "";
      if (linkCol < row.length) {
        if (richText && richText[r] && richText[r][linkCol]) {
          linkVal = (richText[r][linkCol].getLinkUrl() || "").trim();
        }
        if (!linkVal && row[linkCol]) {
          linkVal = row[linkCol].toString().trim();
        }
      }
      if (!linkVal || linkVal.indexOf("drive.google.com") !== -1) {
        linkVal = "";
        for (var c = 0; c < row.length; c++) {
          var cellUrl = (richText && richText[r] && richText[r][c]) ? (richText[r][c].getLinkUrl() || "") : "";
          var candidate = cellUrl || (row[c] || "").toString().trim();
          if (candidate.indexOf("thienkhoi.com") !== -1) {
            linkVal = candidate.trim();
            break;
          }
        }
      }

      // 5. KIỂM TRA TRÙNG LẶP THÔNG MINH (Link PropTech + Độ giống Tiêu Đề >= 78%)
      var normLinkVal = normalizePropTechUrl(linkVal);
      if (normLinkVal && postedLinksLookup[normLinkVal]) {
        continue;
      }

      var bestMatchPct = 0;
      var bestMatchCode = "";
      for (var cp = 0; cp < comparePool.length; cp++) {
        var simPct = calculateStringSimilarityPercent(titleVal, comparePool[cp].title);
        if (simPct > bestMatchPct) {
          bestMatchPct = simPct;
          bestMatchCode = comparePool[cp].code;
        }
        if (bestMatchPct >= 88) break;
      }

      if (bestMatchPct >= 88) {
        continue;
      }

      // Quy đổi giá bán sang Tỷ
      var rawPrice = (priceCol < row.length) ? row[priceCol] : 0;
      var rawDrop = (dropPriceCol < row.length) ? row[dropPriceCol] : 0;
      var numPrice = parseFloat(String(rawPrice).replace(/[^\d\.]/g, "")) || 0;
      var numDrop = parseFloat(String(rawDrop).replace(/[^\d\.]/g, "")) || 0;

      if (numPrice > 1000000) numPrice = Math.round((numPrice / 1000000000) * 100) / 100;
      if (numDrop > 1000000) numDrop = Math.round((numDrop / 1000000000) * 100) / 100;

      var finalPriceTy = (numDrop > 0 && numDrop < numPrice) ? numDrop : numPrice;
      var priceText = finalPriceTy > 0 ? (finalPriceTy + " tỷ") : "";

      seenUnpostedCodes[normCode] = true;
      if (normLinkVal) {
        postedLinksLookup[normLinkVal] = rawCode;
      }
      comparePool.push({
        code: rawCode,
        title: titleVal,
        normTitle: normalizeProductTitleForCompare(titleVal),
        normLink: normLinkVal
      });

      var isSuspectDup = (bestMatchPct >= 78 && bestMatchPct < 88);
      var displayTitle = isSuspectDup
        ? ("⚠️ Nghi trùng " + bestMatchPct + "% với mã " + bestMatchCode + " | " + titleVal)
        : titleVal;

      var itemRecord = {
        sheet_name: sheetName,
        internal_code: rawCode,
        product_title: displayTitle,
        website_link: linkVal,
        price_ty: finalPriceTy,
        price_text: priceText,
        is_suspect_dup: isSuspectDup
      };

      if (isSuspectDup) {
        suspectResults.push(itemRecord);
      } else {
        cleanResults.push(itemRecord);
      }
    }
  }

  return cleanResults.concat(suspectResults);
}

/**
 * Chuẩn hóa URL website / proptech để đối chiếu trùng lặp
 */
function normalizePropTechUrl(url) {
  if (!url) return "";
  var s = url.toString().trim().toLowerCase();
  s = s.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  s = s.split("?")[0].split("#")[0];
  s = s.replace(/\/+$/, "");
  return s;
}

/**
 * Chuẩn hóa tiêu đề sản phẩm để so sánh độ tương đồng (bỏ dấu tiếng Việt, ký tự đặc biệt)
 */
function normalizeProductTitleForCompare(title) {
  if (!title) return "";
  var str = title.toString().toLowerCase();
  if (str.indexOf("nghi trùng") !== -1 && str.indexOf("|") !== -1) {
    str = str.split("|").slice(1).join(" ");
  }
  str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a");
  str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e");
  str = str.replace(/ì|í|ị|ỉ|ĩ/g, "i");
  str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o");
  str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u");
  str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y");
  str = str.replace(/đ/g, "d");
  str = str.replace(/[^a-z0-9\s]/g, " ");
  return str.replace(/\s+/g, " ").trim();
}

/**
 * Tính toán tỷ lệ tương đồng giữa 2 chuỗi tiêu đề sản phẩm (0 -> 100%)
 */
function calculateStringSimilarityPercent(str1, str2) {
  if (!str1 || !str2) return 0;
  var s1 = normalizeProductTitleForCompare(str1);
  var s2 = normalizeProductTitleForCompare(str2);
  if (s1 === s2) return 100;
  if (!s1 || !s2) return 0;

  var words1 = s1.split(" ").filter(function(w) { return w.length > 0; });
  var words2 = s2.split(" ").filter(function(w) { return w.length > 0; });
  if (words1.length === 0 || words2.length === 0) return 0;

  var set1 = {};
  for (var i = 0; i < words1.length; i++) set1[words1[i]] = true;
  var common = 0;
  for (var j = 0; j < words2.length; j++) {
    if (set1[words2[j]]) common++;
  }
  var union = Object.keys(set1).length + words2.length - common;
  var jaccard = union > 0 ? (common / union) : 0;

  var len1 = s1.length;
  var len2 = s2.length;
  var matrix = [];
  for (var r = 0; r <= len2; r++) matrix[r] = [r];
  for (var c = 0; c <= len1; c++) matrix[0][c] = c;
  for (var r = 1; r <= len2; r++) {
    for (var c = 1; c <= len1; c++) {
      if (s2.charAt(r - 1) === s1.charAt(c - 1)) {
        matrix[r][c] = matrix[r - 1][c - 1];
      } else {
        matrix[r][c] = Math.min(matrix[r - 1][c - 1] + 1, matrix[r][c - 1] + 1, matrix[r - 1][c] + 1);
      }
    }
  }
  var dist = matrix[len2][len1];
  var maxLen = Math.max(len1, len2);
  var levSim = 1 - (dist / maxLen);

  var combined = (jaccard * 0.6) + (levSim * 0.4);
  return Math.round(combined * 100);
}

/**
 * Render mảng Danh sách căn chưa đăng vào Cột Y -> AD (cột 25 -> 30) trên tab DATA_NHA
 */
function renderUnpostedProductsToDataNha(sheet, listings, soldCodes) {
  if (!sheet) return 0;

  var postedCodesLookup = {};
  var postedRecords = [];

  if (listings && listings.length > 0) {
    for (var i = 0; i < listings.length; i++) {
      var item = listings[i];
      var rawC = (item.internal_code || "").toString().trim().toUpperCase();
      var normC = rawC.replace(/\s+/g, "");
      if (normC) postedCodesLookup[normC] = true;
      postedRecords.push({
        internal_code: rawC,
        product_title: item.product_title || item.title || "",
        website_link: item.website_link || item.url || ""
      });
    }
  }

  if (!soldCodes || soldCodes.length === 0) {
    soldCodes = getSoldSignaturesFromSourceSheets();
  }

  var unpostedList = getUnpostedProductsFromSourceSheets(postedCodesLookup, soldCodes, postedRecords);

  // Xóa vùng dữ liệu cũ ở mảng Cột Y -> AD (từ cột 25 đến cột 30)
  var maxRows = Math.max(sheet.getLastRow(), 100);
  try {
    sheet.getRange(1, 25, maxRows, 6).clearContent().clearFormat();
  } catch (eClear) {}

  // Ghi tiêu đề Cột Y -> AD
  var unpostedHeaders = [
    "Sheet Nguồn", "Mã SP", "Tiêu Đề Sản Phẩm", "Link Website", "Giá Bán", "Ghi Chú Trùng Lặp"
  ];
  var unpostedHeaderRange = sheet.getRange(1, 25, 1, 6);
  unpostedHeaderRange.setValues([unpostedHeaders]);
  unpostedHeaderRange.setBackground("#1D4ED8")
                     .setFontColor("#FFFFFF")
                     .setFontWeight("bold")
                     .setHorizontalAlignment("center");
  sheet.setColumnWidth(25, 160);
  sheet.setColumnWidth(26, 120);
  sheet.setColumnWidth(27, 280);
  sheet.setColumnWidth(28, 220);
  sheet.setColumnWidth(29, 100);
  sheet.setColumnWidth(30, 240);

  if (!unpostedList || unpostedList.length === 0) return 0;

  var unpostedRows = [];
  for (var u = 0; u < unpostedList.length; u++) {
    var up = unpostedList[u];
    unpostedRows.push([
      up.sheet_name || "",
      up.internal_code || "",
      up.product_title || "",
      up.website_link || "",
      up.price_text || (up.price_ty ? (up.price_ty + " tỷ") : ""),
      up.is_suspect_dup ? "⚠️ Nghi trùng" : "✅ Sẵn sàng đăng"
    ]);
  }

  sheet.getRange(2, 25, unpostedRows.length, 6).setValues(unpostedRows);
  return unpostedRows.length;
}

/**
 * Hàm kích hoạt thủ công từ Google Apps Script Editor để cập nhật riêng Cột Y -> AD
 */
function updateUnpostedProductsOnDataNha() {
  var ss = getSpreadsheet();
  if (!ss) return;
  var sheet = ss.getSheetByName(CONFIG.DATA_NHA_SHEET_NAME);
  if (!sheet) return;

  var listings = getListingsFromSheet();
  var soldCodes = getSoldSignaturesFromSourceSheets();
  var count = renderUnpostedProductsToDataNha(sheet, listings, soldCodes);
  Logger.log("Đã cập nhật " + count + " căn chưa đăng vào Cột Y -> AD trên tab DATA_NHA");
}

/**
 * Trích xuất bản đồ Tiêu đề sản phẩm và Link website từ 7 sheet nguồn theo Mã SP
 * @return {Object} { "MÃ_SP_CHUẨN_HÓA": { title: "...", link: "..." } }
 */
function getSourceProductDetailsMap() {
  var ss = getSpreadsheet();
  if (!ss) return {};

  var SOURCE_SHEETS = CONFIG.SOURCE_SHEETS || CONFIG.PRODUCT_SHEETS || [
    "BDS TMT-TTH-3.5-6TY",
    "NHÀ GÒ VẤP 5-7TY",
    "BDS 3.5-5 TỶ",
    "BDS DƯỚI 3.5 TỶ",
    "BDS 5-8 TỶ",
    "BDS 8-15 TỶ",
    "BDS 15-25 TỶ"
  ];
  var detailsMap = {};

  for (var s = 0; s < SOURCE_SHEETS.length; s++) {
    var sheetName = SOURCE_SHEETS[s];
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) continue;

    var range = sheet.getDataRange();
    var data = range.getValues();
    if (data.length <= 1) continue;

    var richText = null;
    try {
      richText = range.getRichTextValues();
    } catch (eRich) {
      Logger.log("Không thể lấy getRichTextValues từ " + sheetName + ": " + eRich);
    }

    var header = data[0];
    var codeCol = 5; // Mặc định Cột F (index 5)
    var titleCol = -1;
    var linkCol = -1;

    for (var h = 0; h < header.length; h++) {
      var hText = (header[h] || "").toString().toLowerCase().trim();
      if (hText.indexOf("mã sp") !== -1 || hText.indexOf("ma sp") !== -1) {
        codeCol = h;
      }
      if (hText.indexOf("tiêu đề") !== -1 || hText.indexOf("tieu de") !== -1 ||
          hText.indexOf("tên sản phẩm") !== -1 || hText.indexOf("ten san pham") !== -1 ||
          hText.indexOf("tên nhà") !== -1 || hText.indexOf("ten nha") !== -1 ||
          (hText.indexOf("sản phẩm") !== -1 && titleCol === -1)) {
        titleCol = h;
      }
      if (hText.indexOf("link website") !== -1 || hText.indexOf("website") !== -1 ||
          hText.indexOf("link web") !== -1 || hText.indexOf("link") !== -1 ||
          hText.indexOf("url") !== -1) {
        linkCol = h;
      }
    }

    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      var rawCode = row[codeCol] ? row[codeCol].toString().trim().toUpperCase() : "";
      var normCode = rawCode.replace(/\s+/g, "");
      if (!normCode) continue;

      var titleVal = "";
      if (titleCol >= 0 && row[titleCol] !== undefined && row[titleCol] !== null) {
        titleVal = row[titleCol].toString().trim();
      }

      var linkVal = "";
      if (linkCol >= 0) {
        // Ưu tiên 1: Lấy hyperlink từ RichText nếu ô chứa anchor text gắn link
        if (richText && richText[r] && richText[r][linkCol]) {
          var richUrl = richText[r][linkCol].getLinkUrl();
          if (richUrl) linkVal = richUrl.trim();
        }
        // Ưu tiên 2: Lấy chuỗi text thông thường nếu ô hiển thị URL trực tiếp
        if (!linkVal && row[linkCol]) {
          var rawLink = row[linkCol].toString().trim();
          if (rawLink.indexOf("http") !== -1 || rawLink.indexOf(".vn") !== -1 || rawLink.indexOf(".com") !== -1) {
            linkVal = rawLink;
          }
        }
      }

      // Dự phòng: nếu cột titleCol có gắn hyperlink trực tiếp vào chữ
      if (!linkVal && titleCol >= 0 && richText && richText[r] && richText[r][titleCol]) {
        var richTitleUrl = richText[r][titleCol].getLinkUrl();
        if (richTitleUrl) linkVal = richTitleUrl.trim();
      }

      if (!detailsMap[normCode]) {
        detailsMap[normCode] = {
          title: titleVal,
          link: linkVal
        };
      } else {
        if (!detailsMap[normCode].title && titleVal) detailsMap[normCode].title = titleVal;
        if (!detailsMap[normCode].link && linkVal) detailsMap[normCode].link = linkVal;
      }
    }
  }

  return detailsMap;
}

/**
 * Tự động tạo & cập nhật cột "Đã đăng Nhadat247" trên 7 sheet sản phẩm
 */
function markPostedNhadat247OnProductSheets(postedCodesSet) {
  var ss = getSpreadsheet();
  if (!ss) return 0;

  var productSheets = CONFIG.PRODUCT_SHEETS || [
    "BDS TMT-TTH-3.5-6TY",
    "NHÀ GÒ VẤP 5-7TY",
    "BDS 3.5-5 TỶ",
    "BDS DƯỚI 3.5 TỶ",
    "BDS 5-8 TỶ",
    "BDS 8-15 TỶ",
    "BDS 15-25 TỶ"
  ];

  var codeLookup = {};
  if (Array.isArray(postedCodesSet)) {
    for (var i = 0; i < postedCodesSet.length; i++) {
      var c = (postedCodesSet[i] || "").toString().trim().toUpperCase();
      if (c) codeLookup[c] = true;
    }
  } else if (postedCodesSet && typeof postedCodesSet === "object") {
    var keys = Object.keys(postedCodesSet);
    for (var k = 0; k < keys.length; k++) {
      var ck = (keys[k] || "").toString().trim().toUpperCase();
      if (ck) codeLookup[ck] = true;
    }
  }

  if (Object.keys(codeLookup).length === 0) {
    var dataNhaSheet = ss.getSheetByName(CONFIG.DATA_NHA_SHEET_NAME);
    if (dataNhaSheet && dataNhaSheet.getLastRow() > 1) {
      var dVals = dataNhaSheet.getDataRange().getValues();
      for (var r = 1; r < dVals.length; r++) {
        var code = (dVals[r][19] || "").toString().trim().toUpperCase();
        if (code) {
          codeLookup[code] = true;
        }
      }
    }
  }

  var updatedSheetsCount = 0;

  for (var s = 0; s < productSheets.length; s++) {
    var sheetName = productSheets[s];
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) continue;

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 1 || lastCol < 1) continue;

    var headerValues = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

    var postedColIndex = -1;
    var codeColIndex = -1;

    for (var col = 0; col < headerValues.length; col++) {
      var hText = (headerValues[col] || "").toString().trim().toLowerCase();
      if (hText.indexOf("đã đăng nhadat247") !== -1 || hText.indexOf("da dang nhadat247") !== -1) {
        postedColIndex = col + 1;
      }
      if (hText.indexOf("mã sp") !== -1 || hText.indexOf("ma sp") !== -1) {
        codeColIndex = col + 1;
      }
    }

    if (codeColIndex === -1) {
      codeColIndex = 6;
    }

    if (postedColIndex === -1) {
      postedColIndex = lastCol + 1;
      var headerCell = sheet.getRange(1, postedColIndex);
      headerCell.setValue("Đã đăng Nhadat247");
      headerCell.setBackground("#059669")
                .setFontColor("#FFFFFF")
                .setFontWeight("bold")
                .setHorizontalAlignment("center");
      sheet.setColumnWidth(postedColIndex, 150);
    }

    if (lastRow > 1) {
      var numRows = lastRow - 1;
      var codeValues = sheet.getRange(2, codeColIndex, numRows, 1).getValues();
      var outputValues = [];
      var bgColors = [];
      var fontColors = [];
      var fontWeights = [];

      for (var rowIdx = 0; rowIdx < numRows; rowIdx++) {
        var rawCode = (codeValues[rowIdx][0] || "").toString().trim();
        var normCode = rawCode.toUpperCase();

        if (!rawCode) {
          outputValues.push([""]);
          bgColors.push(["#ffffff"]);
          fontColors.push(["#000000"]);
          fontWeights.push(["normal"]);
        } else if (codeLookup[normCode]) {
          outputValues.push(["✅ Đã đăng"]);
          bgColors.push(["#ecfdf5"]);
          fontColors.push(["#065f46"]);
          fontWeights.push(["bold"]);
        } else {
          outputValues.push(["Chưa đăng"]);
          bgColors.push(["#ffffff"]);
          fontColors.push(["#64748b"]);
          fontWeights.push(["normal"]);
        }
      }

      var targetRange = sheet.getRange(2, postedColIndex, numRows, 1);
      targetRange.setValues(outputValues);
      targetRange.setBackgrounds(bgColors);
      targetRange.setFontColors(fontColors);
      targetRange.setFontWeights(fontWeights);
      targetRange.setHorizontalAlignment("center");
    }

    updatedSheetsCount++;
  }

  Logger.log("Đã cập nhật trạng thái 'Đã đăng Nhadat247' trên " + updatedSheetsCount + " sheet sản phẩm.");
  return updatedSheetsCount;
}

/**
 * Kiểm tra xem 1 tin đăng có khớp với danh sách căn đã cọc/đã bán không
 */
function checkIfListingSold(item, soldCodes) {
  if (!item) return false;

  var statusText = (item.status || "").toString().toLowerCase();
  if (item.is_sold === true || statusText.indexOf("đã bán") !== -1 || statusText.indexOf("đã cọc") !== -1 || statusText.indexOf("da ban") !== -1 || statusText.indexOf("da coc") !== -1) {
    return true;
  }

  if (!soldCodes || soldCodes.length === 0) return false;

  var internalCode = (item.internal_code || "").toString().trim().toUpperCase().replace(/\s+/g, "");
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
 * Lưu toàn bộ danh sách căn nhà vào tab `DATA_NHA` (22 cột, kèm Tiêu Đề Sản Phẩm & Link Website)
 */
function syncListingsToSheet(listings, overwritePurposes) {
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
          internal_code: oRow[19] ? oRow[19].toString().trim() : "",
          product_title: oRow[20] ? oRow[20].toString().trim() : "",
          website_link: oRow[21] ? oRow[21].toString().trim() : ""
        };
      }
    }
  }

  sheet.clearContents();

  var headers = [
    "Mã Tin", "Tiêu Đề", "Mức Giá (Tỷ)", "Giá Gốc", "Giảm Chào", "Giá Cũ (Tỷ)",
    "Diện Tích (m²)", "Số PN", "Hẻm / Đường", "Phường / Xã", "Quận", "Link Tin Gốc",
    "Ảnh Đại Diện", "Mô Tả Ngắn", "Mục Đích", "Phân Loại Dòng Tiền", "Thu Nhập Thuê", "Cập Nhật Lúc", "Trạng Thái", "Mã SP",
    "Tiêu Đề Sản Phẩm", "Link Website"
  ];
  sheet.appendRow(headers);

  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground("#059669").setFontColor("#FFFFFF").setFontWeight("bold");

  var soldCodes = getSoldSignaturesFromSourceSheets();
  var sourceDetailsMap = getSourceProductDetailsMap();
  var rows = [];

  for (var i = 0; i < listings.length; i++) {
    var item = listings[i];
    var itemId = item.id || "";
    var existing = existingMap[itemId] || null;

    var purposesStr = "";
    if (!overwritePurposes && existing && existing.purposes) {
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
    var normCode = internalCode.replace(/\s+/g, "");

    var isSold = checkIfListingSold({
      id: itemId,
      internal_code: normCode,
      status: item.status,
      is_sold: item.is_sold
    }, soldCodes);

    if (existing && existing.status) {
      if (existing.status.indexOf("Đã bán") !== -1 || existing.status.indexOf("Đã cọc") !== -1) {
        isSold = true;
      }
    }

    var statusDisplay = "Đang bán";
    if (isSold) {
      statusDisplay = "🚫 Đã bán";
    } else if (existing && existing.status) {
      statusDisplay = existing.status;
    } else {
      statusDisplay = (item.status && item.status.indexOf("sold") !== -1) ? "🚫 Đã bán" : "Đang bán";
    }

    // Tra cứu Tiêu đề sản phẩm & Link website từ 7 sheet nguồn
    var srcDetail = (normCode && sourceDetailsMap[normCode]) ? sourceDetailsMap[normCode] : null;

    var productTitle = "";
    if (existing && existing.product_title) {
      productTitle = existing.product_title;
    } else if (srcDetail && srcDetail.title) {
      productTitle = srcDetail.title;
    } else {
      productTitle = item.product_title || "";
    }

    var websiteLink = "";
    if (existing && existing.website_link) {
      websiteLink = existing.website_link;
    } else if (srcDetail && srcDetail.link) {
      websiteLink = srcDetail.link;
    } else {
      websiteLink = item.website_link || "";
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
      internalCode,
      productTitle,
      websiteLink
    ]);
  }

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);

    var totalDataRows = Math.max(rows.length, 50);

    var rulePurposes = SpreadsheetApp.newDataValidation()
      .requireValueInList(["de_o", "dong_tien", "kinh_doanh", "dat", "de_o, kinh_doanh", "de_o, dong_tien", "dong_tien, kinh_doanh", "de_o, dong_tien, kinh_doanh"], true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, 15, totalDataRows, 1).setDataValidation(rulePurposes);

    var ruleCashflow = SpreadsheetApp.newDataValidation()
      .requireValueInList(["", "day_tro", "chdv", "tiem_nang_chdv"], true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, 16, totalDataRows, 1).setDataValidation(ruleCashflow);

    var ruleStatus = SpreadsheetApp.newDataValidation()
      .requireValueInList(["Đang bán", "🚫 Đã bán"], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(2, 19, totalDataRows, 1).setDataValidation(ruleStatus);
  }

  try {
    var postedCodesMap = {};
    for (var l = 0; l < listings.length; l++) {
      var pCode = (listings[l].internal_code || "").toString().trim().toUpperCase();
      if (pCode) postedCodesMap[pCode] = true;
    }
    for (var rw = 0; rw < rows.length; rw++) {
      var rCode = (rows[rw][19] || "").toString().trim().toUpperCase();
      if (rCode) postedCodesMap[rCode] = true;
    }
    markPostedNhadat247OnProductSheets(postedCodesMap);
  } catch (errPost) {
    Logger.log("Lỗi khi cập nhật cột Đã đăng Nhadat247: " + errPost);
  }

  // 3. Tự động đồng bộ mảng "Danh sách căn chưa đăng" vào Cột Y -> AD trên tab DATA_NHA
  try {
    renderUnpostedProductsToDataNha(sheet, listings, soldCodes);
  } catch (errUnposted) {
    Logger.log("Lỗi khi render mảng căn chưa đăng vào Cột Y->AD: " + errUnposted);
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
    var productTitleVal = r[20] ? r[20].toString().trim() : "";
    var websiteLinkVal = r[21] ? r[21].toString().trim() : "";

    var isSold = statusVal.indexOf("Đã bán") !== -1 || statusVal.indexOf("Đã cọc") !== -1;

    var itemObj = {
      id: itemId,
      title: r[1],
      price_ty: parseFloat(r[2]) || 0,
      price_text: r[3],
      is_price_dropped: r[4].toString().indexOf("GIẢM") !== -1,
      old_price_ty: parseFloat(r[5]) || null,
      area_m2: parseFloat(r[6]) || 0,
      bedrooms: parseInt(r[7], 10) || 0,
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
      internal_code: internalCode,
      product_title: productTitleVal,
      website_link: websiteLinkVal
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

  if (targetRow === -1) {
    sheet.appendRow([todayStr, 0, 0, 0]);
    targetRow = sheet.getLastRow();
  }

  var currentValues = sheet.getRange(targetRow, 2, 1, 3).getValues()[0];
  var uniqueCount = parseInt(currentValues[0], 10) || 0;
  var pageviewCount = parseInt(currentValues[1], 10) || 0;
  var drawerCount = parseInt(currentValues[2], 10) || 0;

  if (evt === "open_drawer" && isUnique) {
    drawerCount += 1;
  } else {
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

    var uVal = parseInt(row[1], 10) || 0;
    var pVal = parseInt(row[2], 10) || 0;
    var drVal = parseInt(row[3], 10) || 0;

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

/**
 * ==============================================================================
 * MODULE MỚI: TỰ ĐỘNG HÓA TELEGRAM BOT 24/7 QUA GOOGLE APPS SCRIPT
 * ==============================================================================
 */

/**
 * Xử lý webhook update gửi từ Telegram Bot API
 */
function handleTelegramWebhook(data) {
  var updateId = data.update_id;
  var scriptProps = PropertiesService.getScriptProperties();

  // 1. Chống lặp tin do Telegram retry Webhook (update_id deduplication)
  if (updateId) {
    var lastUpdateId = parseInt(scriptProps.getProperty("LAST_TG_UPDATE_ID") || "0", 10);
    if (updateId <= lastUpdateId) {
      Logger.log("Bỏ qua duplicate update_id: " + updateId + " <= " + lastUpdateId);
      return ContentService.createTextOutput("OK");
    }
    scriptProps.setProperty("LAST_TG_UPDATE_ID", String(updateId));
  }

  var msg = data.message || {};
  var chatId = msg.chat ? msg.chat.id.toString() : "";
  var text = (msg.text || "").trim();

  // Kiểm tra bảo mật CHAT_ID: Chỉ cho phép tài khoản của chủ nhân điều khiển bot
  if (chatId !== String(CONFIG.TELEGRAM_CHAT_ID)) {
    Logger.log("Từ chối truy cập từ chat_id không hợp lệ: " + chatId);
    return ContentService.createTextOutput("OK");
  }

  var lowerText = text.toLowerCase();

  // =========================================================================
  // LỆNH 1: DỪNG KHẨN CẤP (/dung, /stop, dừng, tat thong bao, tắt thông báo)
  // =========================================================================
  if (lowerText === "/dung" || lowerText === "/stop" || lowerText === "dừng" || lowerText === "dung" ||
      lowerText === "tắt thông báo" || lowerText === "tat thong bao" || lowerText === "dừng lại" || lowerText === "stop") {

    scriptProps.setProperty("BOT_PAUSED", "true");
    var cancelledRuns = cancelRunningGitHubWorkflows();

    var stopMsg = "🛑 <b>ĐÃ DỪNG KHẨN CẤP THÀNH CÔNG!</b>\n\n" +
      "• Đã quét hàng đợi và hủy <b>" + cancelledRuns + " tiến trình đám mây</b> bằng cả cancel và force-cancel.\n" +
      "• Đã tạm khóa (disable) workflow <code>" + CONFIG.GITHUB_WORKFLOW + "</code> trên GitHub Actions.\n" +
      "• Đã tạm khóa toàn bộ thông báo tự động từ hệ thống.\n\n" +
      "👉 Khi bạn muốn bật lại, hãy nhắn <code>/dongbo</code> hoặc <code>/bat</code>.";

    sendTelegramMessage(chatId, stopMsg);
    return ContentService.createTextOutput("OK");
  }

  // =========================================================================
  // LỆNH 2: BẬT LẠI THÔNG BÁO (/bat, /start_bot, bật thông báo)
  // =========================================================================
  if (lowerText === "/bat" || lowerText === "bật" || lowerText === "bat" || lowerText === "bật thông báo" || lowerText === "bat thong bao") {
    scriptProps.setProperty("BOT_PAUSED", "false");
    setGitHubWorkflowEnabled(true);
    sendTelegramMessage(chatId, "✅ <b>ĐÃ BẬT LẠI THÔNG BÁO & WORKFLOW!</b>\nWorkflow <code>" + CONFIG.GITHUB_WORKFLOW + "</code> đã được mở khóa (enable) lại trên GitHub và hệ thống sẵn sàng hoạt động bình thường.");
    return ContentService.createTextOutput("OK");
  }

  // =========================================================================
  // LỆNH 3: ĐỒNG BỘ (/dongbo, /sync, /capnhat, đồng bộ, cập nhật tin)
  // =========================================================================
  if (lowerText === "/dongbo" || lowerText === "/sync" || lowerText === "/capnhat" ||
      lowerText === "đồng bộ" || lowerText === "dong bo" || lowerText === "cập nhật tin" || lowerText === "cap nhat tin") {

    var lastSyncTs = parseInt(scriptProps.getProperty("LAST_SYNC_TRIGGER_TS") || "0", 10);
    var now = Date.now();
    if (now - lastSyncTs < 180000) {
      var waitSeconds = Math.ceil((180000 - (now - lastSyncTs)) / 1000);
      var cdMsg = "⏳ <b>HỆ THỐNG ĐANG XỬ LÝ ĐỒNG BỘ!</b>\n\n" +
        "Bạn vừa kích hoạt lệnh cách đây ít phút. Để tránh quá tải và trùng lặp dữ liệu, vui lòng đợi thêm <b>" + waitSeconds + " giây</b> nữa trước khi gửi lệnh tiếp theo.\n\n" +
        "💡 <i>Nếu bạn muốn hủy các tiến trình đang chạy, hãy nhắn <code>/dung</code></i>";
      sendTelegramMessage(chatId, cdMsg);
      return ContentService.createTextOutput("OK");
    }

    scriptProps.setProperty("LAST_SYNC_TRIGGER_TS", String(now));
    scriptProps.setProperty("BOT_PAUSED", "false");
    setGitHubWorkflowEnabled(true);

    var ghRes = triggerGitHubWorkflow();

    var reply = "";
    if (ghRes.success) {
      reply = "⏳ <b>ĐÃ NHẬN LỆNH ĐỒNG BỘ!</b>\n\n" +
        "🚀 Hệ thống đám mây <b>GitHub Actions</b> đang cào tin mới từ Nhadat247, đối chiếu 'Đã bán' + lấy Tiêu Đề Sản Phẩm & Link Website từ 7 sheet và cập nhật lên Blogger...\n\n" +
        "⏱ Quá trình chạy khoảng 1 - 2 phút. Sau khi xong, hệ thống sẽ gửi <b>duy nhất 1 tin nhắn tổng hợp</b> về đây!";
    } else {
      reply = "⚠️ <b>KHÔNG THỂ KÍCH HOẠT GITHUB ACTIONS!</b>\n\n" +
        "Chi tiết: " + ghRes.message + "\n\n" +
        "💡 <i>Vui lòng kiểm tra lại <code>GITHUB_PAT</code> trong Script Properties.</i>";
    }

    sendTelegramMessage(chatId, reply);
    return ContentService.createTextOutput("OK");
  }

  // =========================================================================
  // LỆNH 4: QUÉT THIẾU MÃ (/thieuma, /thieu_ma, quét thiếu mã, thiếu mã)
  // =========================================================================
  if (lowerText === "/thieuma" || lowerText === "/thieu_ma" || lowerText === "quét thiếu mã" || lowerText === "thiếu mã" || lowerText === "thieu ma") {
    var report = getMissingCodeReport();
    sendTelegramMessage(chatId, report);
    return ContentService.createTextOutput("OK");
  }

  // =========================================================================
  // LỆNH 5: TRỢ GIÚP (/help, /start, /menu, hướng dẫn)
  // =========================================================================
  if (lowerText === "/help" || lowerText === "/start" || lowerText === "/menu" || lowerText === "menu" || lowerText === "hướng dẫn") {
    var helpMsg = "🤖 <b>BẢNG ĐIỀU KHIỂN TELEGRAM BOT - KHO NHÀ HỒNG CHÂU</b>\n\n" +
      "📋 <b>CÁC LỆNH TỰ ĐỘNG:</b>\n" +
      "• <code>/dongbo</code>: Kích hoạt đồng bộ tin đám mây (cooldown 3 phút).\n" +
      "• <code>/dung</code> hoặc <code>/stop</code>: Dừng khẩn cấp, hủy các tiến trình đang chạy & tạm tắt thông báo.\n" +
      "• <code>/bat</code>: Mở lại thông báo tự động sau khi dừng.\n" +
      "• <code>/thieuma</code>: Quét danh sách tin đang bán chưa có Mã SP.\n" +
      "• <code>/khach Tên - SĐT - Nhu cầu</code>: Lưu khách hàng nhanh vào CRM.\n" +
      "• <code>/menu</code>: Xem bảng hướng dẫn này.\n\n" +
      "💡 <i>Mẹo: Nhắn tin tự nhiên chứa số điện thoại (ví dụ: Chị Lan 0912345678 cần mua nhà Gò Vấp 6 tỷ) để bot tự động lưu vào Sheet.</i>";
    sendTelegramMessage(chatId, helpMsg);
    return ContentService.createTextOutput("OK");
  }

  // =========================================================================
  // LỆNH 6: NHẬP KHÁCH CRM (/khach ... HOẶC tin nhắn chứa SĐT 10 số)
  // =========================================================================
  var isKhachCmd = lowerText.startsWith("/khach") || lowerText.startsWith("/crm") || lowerText.startsWith("/kh ");
  var hasPhone = /\b(0\d{9})\b/.test(text);

  if (isKhachCmd || hasPhone) {
    var parsed = parseCustomerMessage(text);
    if (!parsed.phone) {
      sendTelegramMessage(chatId, "⚠️ <b>Chưa nhận diện được Số Điện Thoại!</b>\n\nVui lòng nhập SĐT 10 số bắt đầu bằng số 0.\n<i>Ví dụ:</i> <code>/khach Anh Minh - 0903123456 - Tìm nhà HXH 4-5 tỷ</code>");
      return ContentService.createTextOutput("OK");
    }

    try {
      var saveRes = saveCustomerFromTelegram(parsed.name, parsed.phone, parsed.note);
      var succMsg = "✅ <b>ĐÃ LƯU KHÁCH HÀNG THÀNH CÔNG VÀO CRM!</b>\n\n" +
        "👤 <b>Khách hàng:</b> " + saveRes.name + "\n" +
        "📞 <b>SĐT:</b> <code>" + saveRes.phone + "</code>\n" +
        "📝 <b>Nhu cầu:</b> " + saveRes.requirement + "\n" +
        "📍 <b>Vị trí lưu:</b> Dòng <b>" + saveRes.row + "</b> (STT: " + saveRes.stt + ") tab <code>" + CONFIG.CUSTOMER_SHEET_NAME + "</code>\n" +
        "⏰ <b>Thời gian:</b> " + saveRes.time;
      sendTelegramMessage(chatId, succMsg);
    } catch (errSave) {
      sendTelegramMessage(chatId, "❌ <b>Lỗi lưu khách hàng:</b> " + errSave.toString());
    }
    return ContentService.createTextOutput("OK");
  }

  sendTelegramMessage(chatId, "👋 Chào bạn! Gõ <code>/menu</code> hoặc <code>/help</code> để xem danh sách lệnh điều khiển hệ thống.");
  return ContentService.createTextOutput("OK");
}

/**
 * Bóc tách nội dung tin nhắn nhập khách (dạng lệnh /khach hoặc tin nhắn tự nhiên)
 */
function parseCustomerMessage(text) {
  var cleanText = text.replace(/^\/(?:khach|crm|kh)\s*/i, "").trim();

  var phoneMatch = cleanText.match(/\b(0\d{9})\b/);
  var phone = phoneMatch ? phoneMatch[1] : "";

  var name = "";
  var note = "";

  if (cleanText.indexOf("-") !== -1) {
    var parts = cleanText.split("-").map(function(s) { return s.trim(); });
    if (parts.length >= 3) {
      name = parts[0];
      if (!phone && parts[1].match(/\b(0\d{9})\b/)) {
        phone = parts[1].match(/\b(0\d{9})\b/)[1];
      }
      note = parts.slice(2).join(" - ");
    } else if (parts.length === 2) {
      name = parts[0];
      note = parts[1];
    }
  } else if (cleanText.indexOf(",") !== -1) {
    var partsComma = cleanText.split(",").map(function(s) { return s.trim(); });
    if (partsComma.length >= 3) {
      name = partsComma[0];
      if (!phone && partsComma[1].match(/\b(0\d{9})\b/)) {
        phone = partsComma[1].match(/\b(0\d{9})\b/)[1];
      }
      note = partsComma.slice(2).join(", ");
    } else if (partsComma.length === 2) {
      name = partsComma[0];
      note = partsComma[1];
    }
  }

  if ((!name || !note) && phoneMatch) {
    var pIdx = cleanText.indexOf(phone);
    var before = cleanText.substring(0, pIdx).replace(/[-:,]/g, "").trim();
    var after = cleanText.substring(pIdx + phone.length).replace(/^[-:,]/, "").trim();
    if (!name) name = before || "Khách Telegram";
    if (!note) note = after || "Cần tư vấn bất động sản";
  }

  if (!name) name = "Khách Telegram";
  if (!note) note = "Cần tư vấn bất động sản";

  return {
    name: name,
    phone: phone,
    note: note
  };
}

/**
 * Lưu khách hàng từ Telegram vào tab `DS KHÁCH HÀNG`
 */
function saveCustomerFromTelegram(clientName, clientPhone, clientNote) {
  var ss = getSpreadsheet();
  if (!ss) throw new Error("Không thể kết nối đến Google Sheet!");

  var sheet = ss.getSheetByName(CONFIG.CUSTOMER_SHEET_NAME);
  if (!sheet) throw new Error("Không tìm thấy tab " + CONFIG.CUSTOMER_SHEET_NAME);

  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var lastRow = sheet.getLastRow();

  var sttColIdx = 0;
  var nameColIdx = 1;
  var phoneColIdx = 5;

  for (var c = 0; c < headers.length; c++) {
    var h = headers[c].toString().toLowerCase().trim();
    if (h === "stt") sttColIdx = c;
    if (h.indexOf("tên") !== -1) nameColIdx = c;
    if (h.indexOf("số điện thoại") !== -1 || h.indexOf("sđt") !== -1) phoneColIdx = c;
  }

  var lastRealRow = 1;
  var lastRealSTT = 0;

  if (lastRow > 1) {
    var numRowsToScan = lastRow - 1;
    var values = sheet.getRange(2, 1, numRowsToScan, headers.length).getValues();

    for (var r = 0; r < values.length; r++) {
      var currentRowNum = r + 2;
      var row = values[r];
      var nameVal = (nameColIdx >= 0 && row[nameColIdx] !== undefined) ? row[nameColIdx].toString().trim() : "";
      var phoneVal = (phoneColIdx >= 0 && row[phoneColIdx] !== undefined) ? row[phoneColIdx].toString().trim() : "";

      if (nameVal !== "" || phoneVal !== "") {
        lastRealRow = currentRowNum;
        var sttVal = parseInt(row[sttColIdx], 10);
        if (!isNaN(sttVal)) {
          lastRealSTT = sttVal;
        }
      }
    }
  }

  var targetRow = lastRealRow + 1;
  var nextSTT = (lastRealSTT > 0) ? (lastRealSTT + 1) : (targetRow - 1);
  if (nextSTT < 1) nextSTT = 1;

  var nowStr = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm");
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

  setColValue(["stt"], nextSTT);
  setColValue(["tên liên lạc", "tên"], clientName);
  setColValue(["kênh liên lạc"], "Telegram Bot (Hồng Châu nhập nhanh)");
  setColValue(["yêu cầu của kh", "yêu cầu"], clientNote);
  setColValue(["phân loại"], "Tệp Khách Nóng");
  setColValue(["số điện thoại", "sđt", "điện thoại"], "'" + clientPhone);
  setColValue(["kênh đăng tin"], "Telegram Bot");
  setColValue(["hành động"], "Cần liên hệ tư vấn");
  setColValue(["sản phẩm khách liên lạc hỏi", "sản phẩm"], "Nhập nhanh từ Telegram");
  setColValue(["nhu cầu phát sinh"], "Nhập nhanh từ Telegram Bot");
  setColValue(["tương tác cuối"], nowStr);
  setColValue(["giai đoạn gần nhất", "giai đoạn"], "Mới tiếp nhận");

  if (targetRow > sheet.getMaxRows()) {
    sheet.insertRowAfter(sheet.getMaxRows());
  }

  sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);

  return {
    status: "success",
    stt: nextSTT,
    row: targetRow,
    name: clientName,
    phone: clientPhone,
    requirement: clientNote,
    time: nowStr
  };
}

/**
 * Bật hoặc tắt workflow trên GitHub Actions
 */
function setGitHubWorkflowEnabled(enable) {
  var pat = PropertiesService.getScriptProperties().getProperty("GITHUB_PAT");
  if (!pat) return false;

  var actionPath = enable ? "enable" : "disable";
  var url = "https://api.github.com/repos/" + CONFIG.GITHUB_REPO + "/actions/workflows/" + CONFIG.GITHUB_WORKFLOW + "/" + actionPath;
  try {
    var response = UrlFetchApp.fetch(url, {
      method: "put",
      headers: {
        "Authorization": "Bearer " + pat,
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "Google-Apps-Script-Telegram-Bot"
      },
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    Logger.log("setGitHubWorkflowEnabled (" + actionPath + ") code: " + code);
    return code === 204 || code === 200;
  } catch (err) {
    Logger.log("Lỗi khi " + actionPath + " workflow: " + err);
    return false;
  }
}

/**
 * Kích hoạt GitHub Actions qua REST API (workflow_dispatch)
 */
function triggerGitHubWorkflow() {
  var pat = PropertiesService.getScriptProperties().getProperty("GITHUB_PAT");
  if (!pat) {
    return {
      success: false,
      message: "Chưa cấu hình GITHUB_PAT trong Script Properties!"
    };
  }

  setGitHubWorkflowEnabled(true);

  var url = "https://api.github.com/repos/" + CONFIG.GITHUB_REPO + "/actions/workflows/" + CONFIG.GITHUB_WORKFLOW + "/dispatches";
  var payload = JSON.stringify({ ref: "main" });
  var options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "Authorization": "Bearer " + pat,
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "Google-Apps-Script-Telegram-Bot"
    },
    payload: payload,
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();
    if (code === 204 || code === 200 || code === 201) {
      return { success: true, message: "Kích hoạt GitHub Actions thành công!" };
    } else {
      return { success: false, message: "GitHub API trả về mã lỗi: " + code + " - " + response.getContentText() };
    }
  } catch (err) {
    return { success: false, message: "Lỗi kết nối GitHub API: " + err.toString() };
  }
}

/**
 * Hủy sạch 100% các workflow GitHub Actions đang chạy hoặc xếp hàng chờ
 */
function cancelRunningGitHubWorkflows() {
  var pat = PropertiesService.getScriptProperties().getProperty("GITHUB_PAT");
  if (!pat) {
    Logger.log("Chưa cấu hình GITHUB_PAT");
    return 0;
  }

  setGitHubWorkflowEnabled(false);

  var cancelledCount = 0;
  var seenRunIds = {};

  var url = "https://api.github.com/repos/" + CONFIG.GITHUB_REPO + "/actions/runs?per_page=100";
  try {
    var response = UrlFetchApp.fetch(url, {
      method: "get",
      headers: {
        "Authorization": "Bearer " + pat,
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "Google-Apps-Script-Telegram-Bot"
      },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() === 200) {
      var data = JSON.parse(response.getContentText());
      var runs = data.workflow_runs || [];

      for (var r = 0; r < runs.length; r++) {
        var run = runs[r];
        var status = (run.status || "").toLowerCase();

        var isActive = status === "in_progress" ||
                       status === "queued" ||
                       status === "waiting" ||
                       status === "requested" ||
                       status === "pending";

        if (isActive && !seenRunIds[run.id]) {
          seenRunIds[run.id] = true;
          var runId = run.id;

          var cancelUrl = "https://api.github.com/repos/" + CONFIG.GITHUB_REPO + "/actions/runs/" + runId + "/cancel";
          UrlFetchApp.fetch(cancelUrl, {
            method: "post",
            headers: {
              "Authorization": "Bearer " + pat,
              "Accept": "application/vnd.github.v3+json",
              "User-Agent": "Google-Apps-Script-Telegram-Bot"
            },
            muteHttpExceptions: true
          });

          var forceCancelUrl = "https://api.github.com/repos/" + CONFIG.GITHUB_REPO + "/actions/runs/" + runId + "/force-cancel";
          UrlFetchApp.fetch(forceCancelUrl, {
            method: "post",
            headers: {
              "Authorization": "Bearer " + pat,
              "Accept": "application/vnd.github.v3+json",
              "User-Agent": "Google-Apps-Script-Telegram-Bot"
            },
            muteHttpExceptions: true
          });

          cancelledCount++;
        }
      }
    }
  } catch (err) {
    Logger.log("Lỗi khi quét và hủy workflow: " + err);
  }

  return cancelledCount;
}

/**
 * Gửi tin nhắn Telegram
 */
function sendTelegramMessage(chatId, text, parseMode) {
  var url = "https://api.telegram.org/bot" + CONFIG.TELEGRAM_BOT_TOKEN + "/sendMessage";
  var payload = {
    chat_id: chatId || CONFIG.TELEGRAM_CHAT_ID,
    text: text,
    parse_mode: parseMode || "HTML",
    disable_web_page_preview: true
  };
  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    return JSON.parse(response.getContentText());
  } catch (err) {
    Logger.log("Lỗi gửi Telegram: " + err);
    return null;
  }
}

/**
 * Quét danh sách tin đang bán nhưng thiếu Mã SP
 */
function getMissingCodeReport() {
  var ss = getSpreadsheet();
  if (!ss) return "Không tìm thấy Spreadsheet.";

  var sheet = ss.getSheetByName(CONFIG.DATA_NHA_SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) return "Kho dữ liệu DATA_NHA trống.";

  var data = sheet.getDataRange().getValues();
  var missingList = [];
  var invalidCodes = ["", "SP", "TIN", "BDS", "MSP", "DE", "VA"];

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var id = (row[0] || "").toString().trim();
    var title = (row[1] || "").toString().trim();
    var price = (row[3] || "").toString().trim();
    var url = (row[11] || "").toString().trim();
    var status = (row[18] || "").toString().trim();
    var code = (row[19] || "").toString().trim().toUpperCase().replace(/\s+/g, "");

    var isSold = status.indexOf("Đã bán") !== -1 || status.indexOf("Đã cọc") !== -1;
    if (!isSold) {
      var hasDigit = false;
      for (var c = 0; c < code.length; c++) {
        if (code[c] >= '0' && code[c] <= '9') {
          hasDigit = true;
          break;
        }
      }
      if (!code || invalidCodes.indexOf(code) !== -1 || !hasDigit) {
        missingList.push({
          row: r + 1,
          id: id,
          title: title,
          price: price,
          url: url
        });
      }
    }
  }

  if (missingList.length === 0) {
    return "🎉 <b>Tuyệt vời!</b> Toàn bộ các căn đang bán trên kho nhà đều đã có <b>Mã SP</b> chuẩn xác!";
  }

  var msg = "⚠️ <b>DANH SÁCH TIN ĐANG BÁN THIẾU MÃ SP (" + missingList.length + " căn):</b>\n\n";
  var limit = Math.min(missingList.length, 12);
  for (var i = 0; i < limit; i++) {
    var it = missingList[i];
    msg += (i + 1) + ". <b>" + it.title.substring(0, 42) + "</b> (" + it.price + ")\n";
    msg += "   Mã tin: <code>" + it.id + "</code> | Dòng: " + it.row + "\n";
    if (it.url) {
      msg += "   🔗 <a href=\"" + it.url + "\">Xem tin Nhadat247</a>\n";
    }
    msg += "\n";
  }

  if (missingList.length > limit) {
    msg += "<i>... và còn " + (missingList.length - limit) + " căn khác chưa có mã SP trên tab DATA_NHA.</i>\n";
  }
  msg += "👉 Bổ sung mã vào mô tả tin nhadat247 hoặc nhập trực tiếp Cột 20 tab DATA_NHA!";
  return msg;
}

/**
 * Đăng ký Webhook cho Telegram Bot kết nối tới Google Apps Script Web App
 */
function setupTelegramWebhook() {
  var webAppUrl = CONFIG.WEBAPP_URL || ScriptApp.getService().getUrl();
  if (!webAppUrl) {
    Logger.log("Chưa triển khai Web App hoặc không lấy được Web App URL.");
    return "Vui lòng triển khai Web App (Deploy as Web App) trước!";
  }
  var url = "https://api.telegram.org/bot" + CONFIG.TELEGRAM_BOT_TOKEN + "/setWebhook?url=" + encodeURIComponent(webAppUrl) + "&drop_pending_updates=true";
  var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var resText = response.getContentText();
  Logger.log("Kết quả setWebhook: " + resText);

  try {
    sendTelegramMessage(CONFIG.TELEGRAM_CHAT_ID, "🚀 <b>Telegram Webhook đã được kích hoạt thành công!</b>\n\nSẵn sàng nhận lệnh:\n• <code>/dongbo</code> - Đồng bộ tin (cooldown 3p)\n• <code>/dung</code> - Dừng khẩn cấp & hủy tiến trình\n• <code>/bat</code> - Bật lại thông báo & workflow\n• <code>/thieuma</code> - Quét thiếu mã\n• <code>/khach</code> - Nhập CRM\n• <code>/menu</code> - Bảng hướng dẫn");
  } catch (e) {}

  return resText;
}