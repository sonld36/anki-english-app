---
name: Phòng tập phản xạ — Experience
description: Kiến trúc thông tin, hành vi, trạng thái và luồng của phòng tập phản xạ nói tiếng Anh.
status: final
created: 2026-08-21
updated: 2026-08-21
design: ./DESIGN.md
sources:
  - ../../prds/prd-anki-english-app-2026-08-20/prd.md
  - ../../prds/prd-anki-english-app-2026-08-20/addendum.md
  - ../../epics.md
---

## Foundation

**Web trên điện thoại (PWA)** là đích. Giai đoạn đầu chạy trên desktop vì nguồn từ
vựng đi qua AnkiConnect, vốn chỉ nghe ở `localhost` trên máy tính bàn — chi tiết và
hệ quả nằm trong PRD §7.

Không dùng thư viện giao diện dựng sẵn. Kiểu dáng viết trực tiếp, lớp tiện ích dùng
chung nằm trong `app/globals.css`. Nhận dạng thị giác do `{DESIGN.md}` sở hữu; tài
liệu này chỉ tham chiếu token theo tên.

Không tài khoản, không đồng bộ. Mọi thứ nằm trên máy người dùng.

## Information Architecture

Sáu bề mặt. Không có màn hình lịch sử — bản ghi hội thoại **chỉ tồn tại đến hết buổi**,
sau bảng tổng kết là mất.

| | Bề mặt | Người dùng làm gì ở đây |
|---|---|---|
| 1 | **Thẻ đến hạn hôm nay** | Màn hình mở app. Xem hôm nay cần luyện gì, mỗi từ kèm số lần đã nói ra được. Một lần chạm là vào buổi |
| 2 | **Chọn deck** | Chỉ khi chưa chọn hoặc muốn đổi |
| 3 | **Chuẩn bị buổi** | Chọn chủ đề, trình độ, và **số từ dùng cho buổi này** |
| 4 | **Buổi luyện** | Trái tim sản phẩm. Khung chat, nói từng lượt, chấm tại chỗ |
| 5 | **Tổng kết buổi** | Bề mặt cuối cùng của một buổi. Sau đây bản ghi biến mất |
| 6 | **Cài đặt** | Gạt chế độ sáng/tối |

**Chưa có trong v1:** màn hình tiến bộ dài hạn. Người dùng chỉ thấy so sánh với buổi
liền trước, trong bảng tổng kết. Đây là khoảng trống có ý thức — xem Open Questions.

## Voice and Tone

Sản phẩm nói như một **huấn luyện viên**, xưng hô với người dùng là **"Bạn"**.

Huấn luyện viên tốt nêu **cụ thể** điều gì đã đúng và **cụ thể** điều gì cần sửa. Không
khen chung chung, không dùng dấu chấm than thay cho nội dung.

**Ranh giới quan trọng nhất:** khi kết quả thật sự tệ, giọng **chuyển sang thẳng** và
bỏ hẳn phần động viên.

> *"Câu này chưa nhận ra được. Nói chậm và to hơn thử xem."*

Nói *"Gần rồi!"* khi người dùng nói sai gần hết là **nói dối**, và họ sẽ nhận ra — rồi
từ đó không tin bất cứ lời khen nào nữa. Cũng **không đổ tại micro** để gỡ thể diện.

Mẫu câu đã duyệt:

| Khoảnh khắc | Câu |
|---|---|
| Nói được một từ lần đầu | *"Bạn vừa nói được `commute` lần đầu. 2,8 giây."* |
| Đạt, nhanh hơn lần trước | *"Chuẩn. 2,1 giây — nhanh hơn lần trước 0,9 giây."* |
| Chưa đạt, còn lượt thử | *"Gần rồi. Âm `/d/` cuối trong `deadline` chưa bật ra. Thử lại nhé."* |
| Thử lần ba, hiện đáp án | *"Câu này khó. Nghe mẫu đã, rồi bạn sẽ gặp lại nó ngày mai."* |
| Hết buổi | *"Xong 8 lượt. Bạn nói được 6 câu không cần gợi ý — tuần trước là 3."* |
| Không có thẻ đến hạn | *"Hôm nay bạn không có từ nào đến hạn. Muốn luyện thêm thì chọn chủ đề bất kỳ."* |

## Component Patterns

**Nút mic** — bấm để bắt đầu, bấm lần nữa để dừng. **Không phải giữ.** Câu dài 8–10 từ
mà phải giữ nút suốt thì mỏi và dễ run tay.

Trạng thái vô hiệu hoá của nút mic **chính là** tín hiệu "chưa tới lượt bạn". Không có
chỉ báo lượt riêng nào khác.

**Thang gợi ý** — hai nấc, mở theo thứ tự cố định: **tình huống** câu đó được dùng, rồi
**từ khoá**. Không có nấc nào hiện toàn bộ câu đích.

Nấc tình huống **không chứa bản dịch tiếng Việt**. Hiện nghĩa tiếng Việt sẽ dạy người
dùng dịch trong đầu — đúng thói quen sản phẩm này sinh ra để phá.

Mở gợi ý **không gọi mạng**. Nội dung sinh sẵn cùng kịch bản và lưu kèm. Người dùng
đang bí; bắt họ đợi mạng ở đúng lúc đó là tệ nhất.

**Thẻ điểm** — dính ngay dưới lượt vừa nói, không nhảy sang màn hình khác. Ba tầng lỗi:
tầng 1 là từ mục tiêu và quyết định Đạt; tầng 2 là lỗi đặc trưng người Việt, hiện nổi
bật nhưng không chặn; tầng 3 là từ chức năng, chỉ hiện khi mở chi tiết.

**Đồng hồ** — hiện cho người dùng thấy, **đếm lên**. Không có giới hạn thời gian, không
có gì xảy ra ở bất kỳ mốc nào. Nó là thước đo, không phải áp lực nhân tạo.

## State Patterns

**Chờ sinh kịch bản (5–15 giây)** — kể tiến trình chứ không để vòng xoay câm:
*"Đang chọn từ… đang viết hội thoại… đang thu giọng mẫu…"*. Chuyển động làm quãng chờ
ngắn lại trong cảm nhận.

**Chờ chấm điểm (~3 giây, giữa mạch hội thoại)** — hiện **ngay** câu người dùng vừa nói;
thẻ điểm hiện dần bên dưới sau đó. Người dùng có cái để đọc trong lúc chờ và nhịp trò
chuyện không gãy.

**Không có thẻ đến hạn** — nói rõ, và vẫn cho vào buổi luyện tự do.

**Anki không chạy** — giữ nguyên cách xử lý hiện có: nêu nguyên nhân kèm hướng dẫn cài
AnkiConnect và mã addon, có nút thử lại.

**Mất mạng giữa buổi** — vẫn nói và nghe lại được. Yêu cầu chấm xếp hàng, có mạng thì
gửi. Số liệu các lượt đã xong không mất.

**Từ chối quyền micro** — nói rõ vì sao cần và chỉ cách bật lại. Không xin lại lần nữa.

**Dịch vụ chấm lỗi** — nói thẳng là chấm hỏng. **Không đoán bừa một con số.** Buổi luyện
vẫn đi tiếp được.

## Interaction Primitives

> Ba cách xử lý đã cân nhắc: [mockups/third-failure-reveal.html](mockups/third-failure-reveal.html) — cách C được chọn.

**Thất bại lần thứ ba** là khoảnh khắc rủi ro nhất của sản phẩm, và được xử lý bằng
**biến hỏng thành bài học nhỏ**:

1. Hiện câu đích, cỡ `{typography.target-sentence}`, tô rõ âm đã hỏng
2. Kèm một khối chỉ dẫn nêu **đúng âm vị** đã sai và mẹo cấu âm cho người Việt
3. Nút nghe mẫu, tốc độ thường
4. Nói rõ câu này sẽ gặp lại ngày mai

Chỉ dẫn phát âm là **văn bản viết sẵn đóng gói theo app**, khoảng 15–20 mục theo âm vị.
**Không sinh động lúc chạy** — cùng lý do như thang gợi ý.

**Người dùng không có nút tự bỏ qua.** Lối thoát chỉ mở sau đủ ba lần thử, và do hệ
thống mở. Lấy quyết định ra khỏi tay người đang nản.

**Số lần thử tối đa 3 mỗi lượt** vừa là ràng buộc sư phạm — lặp dồn làm chậm tốc độ
phát âm và đẩy người học sang đọc thuộc lòng — vừa là lan can chi phí.

## Accessibility Floor

**Không trạng thái nào được truyền đạt chỉ bằng màu.** Luật bắt buộc, không phải gợi ý.

| Trạng thái | Màu | Dấu hiệu thứ hai bắt buộc |
|---|---|---|
| Đạt | `{colors.success}` | `✓` kèm chữ "Đạt" |
| Chưa đạt | `{colors.danger}` | `✗` kèm gạch chân sóng dưới âm sai |
| Cảnh báo tầng 2 | `{colors.warning}` | `!` kèm viền nét đứt |

Toàn bộ sản phẩm sống bằng phản hồi đúng/sai. Khoảng 1 trên 12 nam giới không phân
biệt được đỏ và lục, mà tệp người dùng nghiêng về nam giới làm kỹ thuật.

Mọi cặp màu chữ/nền đạt tối thiểu **4,5:1**. Ba màu trong bảng sáng đã phải làm trầm
xuống để đạt ngưỡng này.

Nút mic là đích chạm chính — 52px, vượt ngưỡng 44px tối thiểu.

Kết quả chấm phải đọc được bằng trình đọc màn hình, không chỉ nhìn thấy: thông báo
trạng thái Đạt/Chưa đạt bằng chữ, không chỉ bằng biểu tượng.

## Key Flows

**UJ-1 — Sơn luyện phản xạ trước khi cả thành phố dậy.** Định nghĩa đầy đủ nằm trong
PRD §2.3; không lặp lại ở đây. Các nhịp mà UX chịu trách nhiệm:

1. Mở app → thẻ đến hạn hiện ngay, không thao tác
2. Một lần chạm vào buổi luyện → chọn chủ đề, trình độ, số từ
3. Chờ có kể tiến trình
4. Khung chat: hệ thống nói, nút mic sáng lên, Sơn nói
5. Câu vừa nói hiện ngay, điểm hiện dần bên dưới
6. **Cao trào** — bật ra một câu hôm qua còn phải mở gợi ý, lần này không cần, và con
   số thời gian thấp hơn hôm qua
7. Kết thúc → tổng kết → bản ghi biến mất

## Open Questions

1. **Màn hình tiến bộ dài hạn đã hoãn khỏi v1** (đã ghi vào phạm vi PRD kèm `[NOTE FOR PM]`). Hệ quả: chỉ số Bắc Đẩu của sản phẩm —
   thời gian bật câu tụt dần theo tuần — **không hiển thị cho người dùng**. Brief gọi đó
   là vũ khí giữ chân mạnh nhất. Cần đưa lại sớm.
2. ~~Bỏ lưu bản ghi qua buổi mâu thuẫn với Story 2.2.~~ **Đã xử lý.** Bản ghi giữ trong
   một buổi; giữ qua nhiều buổi là **hoãn, không bỏ**. Story 2.2 và phạm vi PRD đã sửa.
3. ~~Thư viện chỉ dẫn phát âm chưa có chủ.~~ **Đã xử lý.** Nằm trong Story 2.5, cùng
   phần hiển thị; FR-12 đã ghi yêu cầu.
4. Hai chế độ sáng/tối **cố ý mang tính cách khác nhau**. Suy từ câu trả lời "ok" của
   người dùng chứ chưa được xác nhận dứt khoát.
