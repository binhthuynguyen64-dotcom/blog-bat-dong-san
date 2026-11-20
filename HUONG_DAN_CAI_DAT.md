# 📖 HƯỚNG DẪN CÀI ĐẶT & VẬN HÀNH TOÀN DIỆN
## HỆ THỐNG TRA CỨU BẤT ĐỘNG SẢN & CRM TỰ ĐỘNG: "HỒNG CHÂU - NHÀ ƯNG Ý"

Chào bạn! Đây là tài liệu hướng dẫn từng bước (cực kỳ trực quan, dễ hiểu, dành cho người không chuyên kỹ thuật) để triển khai và làm chủ toàn bộ hệ thống gồm 3 phần:
1. **Module 1:** Tool Python tự động cào tin đăng từ `nhadat247.vn/moi-gioi/nguyenthihongchau.355`, phát hiện nhà hạ giá chào & gợi ý khách hàng tiềm năng gửi qua Telegram/Email (chạy hoàn toàn miễn phí trên GitHub Actions mỗi 2 tiếng).
2. **Module 2:** Google Apps Script Web App gắn vào Google Sheet của bạn làm backend tiếp nhận khách từ Blogger và đồng bộ kho tin nhà.
3. **Module 3:** Trang tra cứu giao diện thẻ lưới chuẩn phong cách hiện đại (như Bách Hóa Xanh deal), tối ưu di động, lọc thông minh, giỏ tư vấn bấm 1 chạm gửi Google Sheet và sao chép sẵn tin nhắn mở Zalo cho khách.

---

## TỔNG QUAN LUỒNG VẬN HÀNH (KHÔNG TỐN CHI PHÍ SERVER)

```
[nhadat247.vn]
      │ (Quét định kỳ mỗi 2 tiếng)
      ▼
[GitHub Actions (scraper.py)] ──► Cập nhật data/listings.json (Host miễn phí)
      │
      ├─► Phát hiện GIẢM CHÀO (price_tracker.py) ──► Bắn Telegram/Email + Mẫu nhắn khách
      │
      └─► So khớp KHÁCH HÀNG CRM (matcher.py) ─────► Báo TOP khách phù hợp ngay lập tức
                                                           ▲
                                                           │ (Đọc data khách)
                                                           │
[Trang Blogger Hồng Châu] ──(Khách gửi giỏ)──► [Google Apps Script Web App]
           │                                               │ (Ghi dòng mới)
           └──────(Mở https://zalo.me/0783515486)────────► [Tab DS KHÁCH HÀNG]
```

---

## BƯỚC 1: TRIỂN KHAI GOOGLE APPS SCRIPT (MODULE 2)

Bạn gắn mã `Code.gs` vào Google Sheet CRM hiện có của bạn:
- **Link Google Sheet:** `https://docs.google.com/spreadsheets/d/1wRZnlRKqBrGdI3yJjx1FNg3AdcdNPbRHRCATS2-95UA/`

### 1.1. Dán mã vào Apps Script
1. Mở file Google Sheet trên trình duyệt máy tính.
2. Trên thanh menu, chọn: **Tiện ích mở rộng** (*Extensions*) -> **Apps Script**.
3. Tại giao diện soạn thảo code, xóa toàn bộ nội dung mặc định cũ.
4. Mở file [Code.gs](file:///D:/affiliate/skill-edit-blogspot/blog-bat-dong-san/Code.gs), sao chép toàn bộ mã nguồn và dán vào.
5. Bấm biểu tượng **Lưu** (hình đĩa mềm hoặc bấm `Ctrl + S`).

### 1.2. Triển khai dạng Ứng Dụng Web (Web App)
1. Ở góc trên bên phải, bấm nút **Triển khai** (*Deploy*) -> Chọn **Tùy chọn triển khai mới** (*New deployment*).
2. Nhấp vào biểu tượng bánh răng ⚙️ bên cạnh "Chọn loại", chọn **Ứng dụng web** (*Web app*).
3. Điền các trường cấu hình như sau:
   - **Mô tả:** `Hong Chau Real Estate API v1`
   - **Thực thi dưới dạng (*Execute as*):** `Tôi (tài khoản email của bạn)`
   - **Ai có quyền truy cập (*Who has access*):** Chọn `Bất kỳ ai` (*Anyone*) ⚠️ **RẤT QUAN TRỌNG**: Bắt buộc chọn "Bất kỳ ai" thì trang Blogger mới gửi được đơn tư vấn về Google Sheet!
4. Bấm **Triển khai** (*Deploy*).
5. Google sẽ hiện cửa sổ yêu cầu cấp quyền:
   - Bấm **Ủy quyền truy cập** (*Authorize access*).
   - Chọn tài khoản Google của bạn.
   - Nếu hiện cảnh báo *"Google chưa xác minh ứng dụng này"*, bạn bấm vào chữ **Nâng cao** (*Advanced*) ở góc dưới -> Bấm tiếp **Đi tới [Tên dự án] (không an toàn)**.
   - Bấm **Cho phép** (*Allow*).
6. Hệ thống sẽ hiển thị **URL ứng dụng web** (có dạng `https://script.google.com/macros/s/AKfycb.../exec`).
   👉 **Hãy copy lại URL này**, bạn sẽ dùng nó ở Bước 2 và Bước 3!

---

## BƯỚC 2: CÀI ĐẶT GITHUB ACTIONS CHẠY ĐỊNH KỲ 2 TIẾNG (MODULE 1)

GitHub Actions sẽ chạy script Python tự động trên đám mây của GitHub, hoàn toàn miễn phí 2.000 phút/tháng, không cần bạn phải bật máy tính.

### 2.1. Đưa thư mục lên GitHub Repository
1. Tạo một Repository mới trên tài khoản GitHub của bạn (ví dụ đặt tên: `blog-bat-dong-san`, để chế độ **Public**).
2. Tải toàn bộ các file trong thư mục `D:\affiliate\skill-edit-blogspot\blog-bat-dong-san` lên GitHub (bằng Git CLI hoặc kéo thả trên web GitHub):
   - `.github/workflows/sync.yml`
   - `requirements.txt`
   - `scraper.py`
   - `price_tracker.py`
   - `matcher.py`
   - `main.py`
   - Thư mục `data/` chứa `listings.json`

### 2.2. Thông tin Telegram Bot chính thức đã kết nối
Hệ thống đã kết nối trực tiếp với bot chuyên dụng cho BĐS:
- **Bot Telegram:** [@BdsBlog_Bot](https://t.me/BdsBlog_Bot)
- **Token:** `9023599834:AAHPZCqknyPCkHfC1XIc24e7SUOLvaiy7CI`
- **Chat ID của Châu:** `1732042281`

### 2.3. Cài đặt Secrets trên GitHub
1. Vào repository trên GitHub của bạn -> Bấm tab **Settings** (Cài đặt) -> Chọn **Secrets and variables** -> Chọn **Actions**.
2. Bấm nút **New repository secret** để thêm các biến bí mật sau:
   - `TELEGRAM_BOT_TOKEN`: `9023599834:AAHPZCqknyPCkHfC1XIc24e7SUOLvaiy7CI`
   - `TELEGRAM_CHAT_ID`: `1732042281`
   - `GAS_WEBAPP_URL`: `https://script.google.com/macros/s/AKfycbyA3xWOq72d1H-GVqh9aZ3FXEFLpyKPcJD78KNB2kRp8GeVMeXggC9aCDd3bYAud6u6/exec`
   - `GAS_API_KEY`: `HongChauNhaUngY2026`
3. *(Tùy chọn nếu muốn nhận thêm qua Gmail)*:
   - `EMAIL_SENDER`: Địa chỉ Gmail gửi đi.
   - `EMAIL_PASSWORD`: Mật khẩu ứng dụng Gmail (App Password 16 chữ số tạo trong Google Account Security).
   - `EMAIL_RECEIVER`: Địa chỉ nhận email.

### 2.4. Cho phép GitHub Actions tự động ghi file (Workflow Permissions)
1. Trong tab **Settings** của Repo -> Chọn **Actions** -> Chọn **General**.
2. Kéo xuống mục **Workflow permissions**:
   - Tích chọn: **Read and write permissions** (Cho phép quyền đọc và ghi để script commit dữ liệu mới).
   - Bấm **Save**.
3. Vào tab **Actions** trên GitHub -> Bấm chọn workflow **"Đồng Bộ Tin Nhà Đất & Báo Khách Tự Động"** -> Bấm nút **Run workflow** để chạy thử ngay lần đầu tiên!

---

## BƯỚC 3: TỰ ĐỘNG CẬP NHẬT TRANG LÊN BLOGGER (GOOGLE BLOGGER API V3)

Hệ thống đã được tích hợp module `blogger_publisher.py` sử dụng **Google Blogger API v3**. Bạn **không cần phải copy-paste thủ công** vào Blogger nữa!

- **Blog ID:** `6393463168628520519` ("Hồng Châu - Nhà Ưng Ý")
- **Page ID:** `6896894773260115609`
- **Tiêu đề trang:** `Kho Nhà Thật Giá Tốt - Hồng Châu Nhà Ưng Ý`

### Cách hoạt động:
1. Mỗi khi chạy `python main.py` (hoặc GitHub Actions chạy định kỳ):
   - Script tự động đọc file `blogger-page.html`.
   - Kết nối trực tiếp vào Blogger thông qua Google Blogger API v3.
   - Ghi đè cập nhật nội dung mới nhất lên trang Blogger của bạn trong 2 giây!
2. Bạn có thể chủ động đẩy lên Blogger bất kỳ lúc nào bằng lệnh:
   ```bash
   python blogger_publisher.py
   ```
3. Link xem trực tiếp trang Blogger sau khi xuất bản:
   👉 **https://hongchaunhaungy.blogspot.com/p/reset-triet-e-container-cua-moi-giao.html**

---

## BƯỚC 4: HƯỚNG DẪN KIỂM TRA & TRẢI NGHIỆM THỰC TẾ

### 1. Trải nghiệm thử trên trang Blogger:
- Bạn mở trang Blogger vừa tạo trên điện thoại hoặc máy tính.
- Thử gõ tìm kiếm đường `Phan Huy Ích` hoặc lọc `Hẻm xe hơi` -> danh sách sẽ co lại mượt mà tức thì.
- Thử bấm **"🔥 Nhà Giảm Chào"** -> chỉ hiện các căn đang có ưu đãi hạ giá.
- Bấm nút **"＋ Bỏ giỏ tư vấn"** trên 1-2 căn nhà -> Nút đổi sang màu xanh **"✓ Đã chọn"** và huy hiệu góc phải màn hình nhảy số (1, 2...).
- Bấm vào biểu tượng **Giỏ tư vấn** ở góc dưới màn hình -> Cửa sổ trượt ra danh sách các căn vừa chọn.
- Nhập Tên, SĐT, Ghi chú và bấm **"Gửi Nhu Cầu & Nhắn Zalo Châu Ngay"**:
  1. Dữ liệu tự động được đẩy ngầm vào tab `DS KHÁCH HÀNG` trong Google Sheet của bạn.
  2. Màn hình hiện thông báo **"Đã copy tin nhắn! Đang mở Zalo chị Châu..."**.
  3. Cửa sổ Zalo mở ra đến số `0783515486`, khách chỉ cần bấm `Ctrl + V` (hoặc chạm Dán trên điện thoại) là gửi ngay trọn bộ thông tin nhà muốn xem!

### 2. Kiểm tra tính năng Báo Giảm Chào & Gợi Ý Khách Hàng (Module 1):
- Mỗi khi chạy, script sẽ tự động so sánh giá chào mới với giá cũ.
- Khi chủ nhà hạ giá:
  - Bot Telegram sẽ lập tức "ting ting" báo cho bạn biết căn nào giảm bao nhiêu triệu.
  - Kèm sẵn **đoạn tin nhắn mẫu soạn riêng cho bạn** để bạn chỉ việc copy gửi thẳng vào nhóm Zalo hoặc chat riêng cho khách hàng đang quan tâm.
- Khi có tin mới đăng:
  - Script tự động đọc tab `DS KHÁCH HÀNG` trên Sheet của bạn, bóc tách nhu cầu ngân sách, vị trí, số phòng, diện tích.
  - Tính điểm khớp (từ 0% đến 100%).
  - Nếu đạt từ 60% trở lên, Bot Telegram sẽ gửi ngay danh sách Top khách hàng tiềm năng nhất kèm SĐT và lý do khớp để bạn gọi điện tư vấn ngay!

---

## DANH MỤC CÁC FILE TRONG DỰ ÁN

| File / Thư mục | Vai trò |
|---|---|
| [blogger-page.html](file:///D:/affiliate/skill-edit-blogspot/blog-bat-dong-san/blogger-page.html) | File giao diện duy nhất nhúng vào Blogger (Bộ lọc, Lưới card, Giỏ hàng, Gửi Zalo) |
| [Code.gs](file:///D:/affiliate/skill-edit-blogspot/blog-bat-dong-san/Code.gs) | Mã Google Apps Script backend gắn vào Google Sheet |
| [scraper.py](file:///D:/affiliate/skill-edit-blogspot/blog-bat-dong-san/scraper.py) | Script cào tin, duyệt phân trang, bóc tách chi tiết thông số bất động sản |
| [price_tracker.py](file:///D:/affiliate/skill-edit-blogspot/blog-bat-dong-san/price_tracker.py) | Script phát hiện nhà hạ giá, tạo pitch chào hàng & gửi Telegram/Email |
| [matcher.py](file:///D:/affiliate/skill-edit-blogspot/blog-bat-dong-san/matcher.py) | Thuật toán so khớp 5 tiêu chí với data khách hàng trong Google Sheet |
| [main.py](file:///D:/affiliate/skill-edit-blogspot/blog-bat-dong-san/main.py) | Bộ điều phối toàn bộ chu kỳ cào tin, kiểm tra giá, gợi ý khách & đồng bộ |
| [.github/workflows/sync.yml](file:///D:/affiliate/skill-edit-blogspot/blog-bat-dong-san/.github/workflows/sync.yml) | Lịch trình tự động chạy trên GitHub Actions mỗi 2 tiếng |
| [requirements.txt](file:///D:/affiliate/skill-edit-blogspot/blog-bat-dong-san/requirements.txt) | Danh sách thư viện Python cần thiết |
| [.env.example](file:///D:/affiliate/skill-edit-blogspot/blog-bat-dong-san/.env.example) | Mẫu điền cấu hình biến môi trường và token bí mật |
| [data/listings.json](file:///D:/affiliate/skill-edit-blogspot/blog-bat-dong-san/data/listings.json) | Dữ liệu kho nhà đã chuẩn hóa |
| [data/price_history.json](file:///D:/affiliate/skill-edit-blogspot/blog-bat-dong-san/data/price_history.json) | Dữ liệu lưu lịch sử giá để phát hiện biến động giảm chào |
