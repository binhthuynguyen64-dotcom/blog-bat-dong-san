// content.js - Nhadat247 Auto Drafts Engine (Manifest V3)

(function () {
  const DRAFT_URL = "https://nhadat247.vn/tai-khoan/quan-ly-tin-dang?status=draft";

  // Template mô tả chuẩn
  const TEMPLATE_DESC = `📍Vị trí: đường Phan Huy Ích, tiện đi ra Quang Trung, Nguyễn Văn Khối, Trường Chinh (Tân Bình), Phan Văn Trị...
🧭 Trong bán kính 1-2km: Emart Phan Huy Ích, trường học 3 cấp, phòng khám, mua sắm, chợ,...
🏡 Diện tích thực tế 50m2, 5PN. BTCT mới đẹp dọn vào ở ngay. Khu cao tầng đồng bộ văn minh. Hẻm xe hơi vào nhà.
✅ Mã SP: 
📞 Gọi/Zalo Châu 0783.515.486 để biết thêm thông tin và xem nhà thực tế.
🏡 NHẬN KÝ GỬI NHÀ ĐẤT TẤT CẢ CÁC QUẬN TPHCM - Alo Châu!`;

  let isActionInProgress = false;

  // -------------------------------------------------------------
  // 1. FLOATING WIDGET UI
  // -------------------------------------------------------------
  function createOrUpdateWidget(state) {
    let widget = document.getElementById("hc-auto-draft-floating-widget");
    if (!widget) {
      widget = document.createElement("div");
      widget.id = "hc-auto-draft-floating-widget";
      widget.innerHTML = `
        <div class="hc-widget-header">
          <div class="hc-widget-title">
            <span>⚡ Nhadat247 Auto Draft</span>
          </div>
          <div class="hc-widget-controls">
            <button class="hc-btn-minimize" id="hc-btn-minimize-toggle" title="Thu nhỏ / Mở rộng">_</button>
          </div>
        </div>
        <div class="hc-widget-body">
          <div class="hc-widget-status-row">
            <span id="hc-widget-pill" class="hc-widget-pill hc-stopped">Đang dừng</span>
            <span id="hc-widget-counter" class="hc-widget-counter">Đã xử lý: 0 tin</span>
          </div>
          <div id="hc-widget-desc" class="hc-widget-desc">Sẵn sàng...</div>
          <div class="hc-widget-actions">
            <button id="hc-widget-btn-stop" class="hc-widget-btn-stop" style="display:none;">
              ⏹ Dừng lại
            </button>
            <button id="hc-widget-btn-resume" class="hc-widget-btn-resume" style="display:none;">
              ▶ Tiếp tục
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(widget);

      // Event listeners for widget buttons
      const btnMin = document.getElementById("hc-btn-minimize-toggle");
      btnMin.addEventListener("click", () => {
        widget.classList.toggle("hc-minimized");
        btnMin.textContent = widget.classList.contains("hc-minimized") ? "□" : "_";
      });

      const btnStop = document.getElementById("hc-widget-btn-stop");
      btnStop.addEventListener("click", () => {
        chrome.storage.local.set({
          isRunning: false,
          currentStatusText: "Đã dừng lại bởi người dùng."
        });
        logMessage("Người dùng đã bấm Dừng trên giao diện nổi.", "warn");
      });

      const btnResume = document.getElementById("hc-widget-btn-resume");
      btnResume.addEventListener("click", () => {
        chrome.storage.local.set({
          isRunning: true,
          currentStatusText: "Tiếp tục chạy tự động..."
        });
        logMessage("Người dùng bấm Tiếp tục trên giao diện nổi.", "info");
      });
    }

    // Update UI elements
    const isRunning = !!state.isRunning;
    const count = state.processedCount || (state.processedIds ? state.processedIds.length : 0);
    const limit = state.limit || 0;
    const desc = state.currentStatusText || "Sẵn sàng.";

    const pill = document.getElementById("hc-widget-pill");
    const counter = document.getElementById("hc-widget-counter");
    const descEl = document.getElementById("hc-widget-desc");
    const btnStop = document.getElementById("hc-widget-btn-stop");
    const btnResume = document.getElementById("hc-widget-btn-resume");

    if (pill) {
      pill.className = `hc-widget-pill ${isRunning ? "hc-running" : "hc-stopped"}`;
      pill.textContent = isRunning ? "Đang chạy..." : "Đang dừng";
    }

    if (counter) {
      if (limit > 0) {
        counter.textContent = `Đã xử lý: ${count} / ${limit} tin`;
      } else {
        counter.textContent = `Đã xử lý: ${count} tin`;
      }
    }

    if (descEl) {
      descEl.textContent = desc;
    }

    if (btnStop && btnResume) {
      if (isRunning) {
        btnStop.style.display = "flex";
        btnResume.style.display = "none";
      } else {
        btnStop.style.display = "none";
        btnResume.style.display = "flex";
      }
    }
  }

  function logMessage(msg, type = "info") {
    const timeStr = new Date().toLocaleTimeString("vi-VN", { hour12: false });
    console.log(`[AutoDraft ${timeStr}] ${msg}`);
    chrome.storage.local.get(["logs"], (res) => {
      const logs = res.logs || [];
      logs.push({ time: timeStr, msg: msg, type: type });
      if (logs.length > 60) logs.shift();
      chrome.storage.local.set({
        logs: logs,
        currentStatusText: msg
      });
    });
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && el.offsetParent !== null;
  }

  // -------------------------------------------------------------
  // 2. STATE MACHINE ROUTER
  // -------------------------------------------------------------
  function runStateMachine() {
    if (isActionInProgress) return;

    chrome.storage.local.get(
      ["isRunning", "limit", "processedCount", "processedIds", "currentDraftId"],
      (state) => {
        createOrUpdateWidget(state);

        if (!state.isRunning) {
          return;
        }

        const url = window.location.href;
        const processedCount = state.processedCount || 0;
        const limit = state.limit || 0;
        const processedIds = state.processedIds || [];

        // Kiểm tra điều kiện dừng: nếu đã đạt limit
        if (limit > 0 && processedCount >= limit) {
          chrome.storage.local.set({
            isRunning: false,
            currentStatusText: `Đã hoàn thành lượt chạy thử nghiệm (${processedCount}/${limit} tin)!`
          });
          logMessage(`🎉 HOÀN TẤT THỬ NGHIỆM: Đã xử lý đủ ${limit} tin nháp. Tự động dừng.`, "success");
          return;
        }

        isActionInProgress = true;

        if (url.includes("/tai-khoan/quan-ly-tin-dang")) {
          handleDraftListPage(state);
        } else if (url.includes("/dang-tin/")) {
          handleEditFormPage(state);
        } else {
          // Trang khác của nhadat247, nếu đang chạy thì chuyển về trang tin nháp
          logMessage("Đang chuyển hướng về trang danh sách tin nháp...", "info");
          setTimeout(() => {
            window.location.href = DRAFT_URL;
          }, 1500);
        }
      }
    );
  }

  // -------------------------------------------------------------
  // 3. XỬ LÝ TRANG DANH SÁCH TIN NHÁP
  // -------------------------------------------------------------
  function handleDraftListPage(state) {
    const processedIds = new Set(state.processedIds || []);
    logMessage("Đang quét danh sách tin nháp trên trang hiện tại...", "info");

    setTimeout(() => {
      // Tìm tất cả ứng viên nút/link Chỉnh sửa
      const allButtonsAndLinks = Array.from(document.querySelectorAll("a, button"));
      const candidates = [];
      const seenIds = new Set();

      allButtonsAndLinks.forEach((el, index) => {
        const txt = (el.textContent || "").trim().toLowerCase();
        const href = el.getAttribute("href") || "";
        const titleAttr = (el.getAttribute("title") || "").toLowerCase();
        const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase();

        // Bỏ qua các nút tạo tin mới ở thanh menu/tiêu đề
        if ((txt === "đăng tin" || txt === "+ đăng tin" || txt.includes("đăng tin mới")) && !txt.includes("chỉnh sửa")) {
          return;
        }

        const isEditTxt = txt === "chỉnh sửa" || txt === "sửa" || txt.includes("chỉnh sửa") ||
                          titleAttr.includes("chỉnh sửa") || ariaLabel.includes("chỉnh sửa");
        const isEditHref = /\/dang-tin\/[a-zA-Z0-9_-]{8,}/.test(href);

        if (isEditTxt || isEditHref) {
          let row = el.closest("tr") || el.closest("div[class*='item']") || el.closest("div[class*='card']") || el.parentElement;
          let title = "";
          let id = "";

          if (row) {
            const titleEl = row.querySelector("h2, h3, h4, a[href*='/ban-'], div[class*='font-semibold'], div[class*='font-medium'], [class*='title']");
            if (titleEl) {
              title = titleEl.textContent.trim();
              const h = titleEl.getAttribute("href") || "";
              const m = h.match(/-([0-9a-f]{6,16})(?:$|\?)/);
              if (m) id = m[1];
            }
          }

          if (!id && href) {
            const mId = href.match(/\/dang-tin\/([^\/\?]+)/);
            if (mId) id = mId[1];
          }

          if (!id) {
            id = "draft_" + (title ? title.substring(0, 20).replace(/[^a-zA-Z0-9]/g, "") : ("idx_" + index));
          }

          if (!seenIds.has(id)) {
            seenIds.add(id);
            candidates.push({
              id: id,
              title: title || ("Tin nháp #" + (candidates.length + 1)),
              element: el,
              href: href
            });
          }
        }
      });

      logMessage(`Tìm thấy ${candidates.length} tin nháp trên trang. Đối chiếu lịch sử...`, "info");

      // Lọc các tin chưa xử lý
      const unprocessed = candidates.filter((c) => !processedIds.has(c.id));

      if (unprocessed.length > 0) {
        const target = unprocessed[0];
        logMessage(`🎯 Chọn tin [${target.id}]: "${target.title.substring(0, 45)}..."`, "info");

        chrome.storage.local.set({
          currentDraftId: target.id,
          currentDraftTitle: target.title,
          currentStatusText: `Đang mở tin: ${target.title.substring(0, 35)}...`
        });

        setTimeout(() => {
          if (target.href && target.href.includes("/dang-tin/")) {
            const targetUrl = target.href.startsWith("/") ? ("https://nhadat247.vn" + target.href) : target.href;
            window.location.href = targetUrl;
          } else {
            target.element.click();
          }
        }, 1200);
      } else {
        // Tất cả tin trên trang này đã xử lý -> Tìm trang kế tiếp
        logMessage("Tất cả tin trên trang này đã được xử lý. Đang tìm nút trang sau...", "warn");

        const nextPageTarget = findNextPageLink();
        if (nextPageTarget) {
          logMessage("Đang chuyển sang trang tiếp theo...", "info");
          setTimeout(() => {
            if (typeof nextPageTarget === "string") {
              window.location.href = nextPageTarget;
            } else {
              nextPageTarget.click();
            }
          }, 1500);
        } else {
          // Không còn trang nào nữa -> Hoàn tất!
          chrome.storage.local.set({
            isRunning: false,
            currentStatusText: "Đã xử lý toàn bộ tất cả tin nháp trên mọi trang!"
          });
          logMessage("🎉 ĐÃ HOÀN TẤT: Không còn tin nháp nào chưa xử lý trên mọi trang!", "success");
        }
      }
    }, 1500);
  }

  function findNextPageLink() {
    // 1. Phân tích tham số URL hiện tại
    const urlObj = new URL(window.location.href);
    const curTrang = parseInt(urlObj.searchParams.get("trang") || "1", 10);
    const nextTrang = curTrang + 1;

    // 2. Tìm thẻ <a> có href chứa trang=(curTrang+1)
    const links = Array.from(document.querySelectorAll("a[href*='trang=']"));
    for (const a of links) {
      if (a.getAttribute("href").includes(`trang=${nextTrang}`)) {
        return a.getAttribute("href");
      }
    }

    // 3. Tìm nút next trong pagination
    const nextBtns = Array.from(document.querySelectorAll("a, button")).filter((el) => {
      const txt = (el.textContent || "").trim();
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      const cls = (el.className || "").toLowerCase();
      return (txt === ">" || txt === "»" || txt === "Trang sau" || aria.includes("next") || cls.includes("next")) && isVisible(el);
    });

    if (nextBtns.length > 0) {
      return nextBtns[0];
    }

    return null;
  }

  // -------------------------------------------------------------
  // 4. XỬ LÝ TRANG CHỈNH SỬA TIN (BƯỚC 1 & BƯỚC 2)
  // -------------------------------------------------------------
  function handleEditFormPage(state) {
    const currentId = state.currentDraftId || ("draft_" + Date.now());
    const processedIds = state.processedIds || [];
    let processedCount = state.processedCount || 0;

    logMessage(`Đang ở trang sửa tin [${currentId}]. Chờ form ổn định...`, "info");

    setTimeout(() => {
      // Tìm ô textarea mô tả
      let textarea = document.querySelector("textarea[name='description'], textarea#description, textarea[placeholder*='mô tả'], textarea");

      // Nếu chưa có textarea -> Đang ở Bước 1 (Địa chỉ BĐS)
      if (!textarea || !isVisible(textarea)) {
        logMessage("Đang ở Bước 1 (Địa chỉ BĐS). Đang tìm nút 'Tiếp tục'...", "info");

        // Thử click tab Bước 2 nếu có
        const step2Tab = Array.from(document.querySelectorAll("div, button, a, span")).find((el) => {
          const t = (el.textContent || "").trim().toLowerCase();
          return (t === "thông tin bđs" || t === "bước 2") && isVisible(el);
        });

        if (step2Tab) {
          step2Tab.click();
        }

        // Bấm nút Tiếp tục
        const nextBtns = Array.from(document.querySelectorAll("button, input[type='submit'], a")).filter((el) => {
          const t = (el.textContent || el.value || "").trim().toLowerCase();
          return (t === "tiếp tục" || t === "tiếp theo" || t.includes("tiếp tục")) && isVisible(el);
        });

        if (nextBtns.length > 0) {
          nextBtns[0].click();
          logMessage("Đã bấm nút 'Tiếp tục'. Chờ chuyển sang Bước 2...", "info");
        } else {
          logMessage("Không tìm thấy nút 'Tiếp tục' ở bước 1. Đang kiểm tra lại...", "warn");
        }

        // Đợi 2 giây và tự kiểm tra lại Bước 2
        setTimeout(() => {
          isActionInProgress = false;
          runStateMachine();
        }, 2200);
        return;
      }

      // Đã ở Bước 2: Thấy ô textarea 'Mô tả chi tiết *'
      logMessage("Đã vào Bước 2 (Thông tin BĐS). Đang kiểm tra nội dung mô tả...", "info");

      textarea.scrollIntoView({ behavior: "smooth", block: "center" });

      const curVal = textarea.value || "";
      const hasContact = curVal.includes("0783.515.486") || curVal.includes("NHẬN KÝ GỬI NHÀ ĐẤT");

      if (hasContact) {
        logMessage(`ℹ️ Tin [${currentId}] đã có sẵn thông tin liên hệ. Bỏ qua không chèn trùng.`, "warn");

        if (!processedIds.includes(currentId)) {
          processedIds.push(currentId);
          processedCount += 1;
        }

        chrome.storage.local.set({
          processedIds: processedIds,
          processedCount: processedCount,
          currentStatusText: `Đã bỏ qua tin ${currentId} (đã có thông tin).`
        });

        setTimeout(() => {
          window.location.href = DRAFT_URL;
        }, 1200);
        return;
      }

      // Chưa có thông tin liên hệ -> Điền TEMPLATE_DESC
      const newVal = curVal.trim() ? (curVal.trim() + "\n\n" + TEMPLATE_DESC) : TEMPLATE_DESC;

      // Kích hoạt React setter để React state cập nhật
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      nativeSetter.call(textarea, newVal);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));

      logMessage(`✅ Đã điền mô tả chuẩn (${newVal.length} ký tự). Đang tìm nút 'Lưu nháp'...`, "success");

      // Cập nhật storage
      if (!processedIds.includes(currentId)) {
        processedIds.push(currentId);
        processedCount += 1;
      }

      chrome.storage.local.set({
        processedIds: processedIds,
        processedCount: processedCount,
        currentStatusText: `Đã điền xong tin ${currentId}. Đang bấm Lưu nháp...`
      });

      setTimeout(() => {
        // Tìm nút Lưu nháp
        const allButtons = Array.from(document.querySelectorAll("button, a, input[type='button']"));
        const saveDraftBtn = allButtons.find((el) => {
          const t = (el.textContent || el.value || "").trim().toLowerCase();
          return (t.includes("lưu nháp") || t.includes("lưu tạm")) && !t.includes("hủy") && isVisible(el);
        });

        if (saveDraftBtn) {
          saveDraftBtn.click();
          logMessage("Đã bấm nút 'Lưu nháp'. Chờ hệ thống lưu...", "success");
        } else {
          // Thử tìm nút Lưu chung
          const altSave = allButtons.find((el) => {
            const t = (el.textContent || el.value || "").trim().toLowerCase();
            return t === "lưu" && isVisible(el);
          });
          if (altSave) {
            altSave.click();
            logMessage("Đã bấm nút 'Lưu'.", "success");
          } else {
            logMessage("Không tìm thấy nút Lưu nháp cụ thể. Tự động điều hướng về...", "warn");
          }
        }

        // Chờ 2.5 giây rồi tự động quay về trang danh sách tin nháp
        setTimeout(() => {
          window.location.href = DRAFT_URL;
        }, 2500);
      }, 1000);
    }, 1800);
  }

  // -------------------------------------------------------------
  // 5. KHỞI CHẠY & LẮNG NGHE STORAGE
  // -------------------------------------------------------------
  // Khi trang tải xong
  window.addEventListener("load", () => {
    setTimeout(() => {
      runStateMachine();
    }, 1000);
  });

  // Lắng nghe thay đổi storage từ Popup hoặc Tab khác
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      chrome.storage.local.get(
        ["isRunning", "limit", "processedCount", "processedIds", "currentDraftId", "currentStatusText"],
        (state) => {
          createOrUpdateWidget(state);
          if (changes.isRunning && changes.isRunning.newValue === true) {
            isActionInProgress = false;
            runStateMachine();
          } else if (changes.isRunning && changes.isRunning.newValue === false) {
            isActionInProgress = false;
          }
        }
      );
    }
  });

  // Khởi tạo widget ngay khi script nạp
  chrome.storage.local.get(
    ["isRunning", "limit", "processedCount", "processedIds", "currentStatusText"],
    (state) => {
      createOrUpdateWidget(state || {});
    }
  );
})();
