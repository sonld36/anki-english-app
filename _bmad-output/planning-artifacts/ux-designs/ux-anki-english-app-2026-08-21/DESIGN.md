---
name: Phòng tập phản xạ
description: Phòng tập phản xạ nói tiếng Anh. Xanh lá, hai chế độ sáng tối, giọng huấn luyện viên. Không streak, không huy hiệu.
status: final
created: 2026-08-21
updated: 2026-08-21
colors:
  surface-base: '#f4f8f2'
  surface-raised: '#ffffff'
  surface-sunken: '#eaf3e8'
  ink-primary: '#1a2b20'
  ink-secondary: '#4e7355'
  ink-muted: '#586f61'
  chrome: '#4e7355'
  success: '#15803d'
  danger: '#be123c'
  warning: '#a16207'
  border-hairline: '#dfe9dc'
  surface-base-dark: '#0a120d'
  surface-raised-dark: '#122018'
  surface-sunken-dark: '#0d1a12'
  ink-primary-dark: '#e6f5ea'
  ink-secondary-dark: '#9db8a8'
  ink-muted-dark: '#7d9a89'
  chrome-dark: '#22c55e'
  success-dark: '#4ade80'
  danger-dark: '#fb7185'
  warning-dark: '#fbbf24'
  border-hairline-dark: '#1d3527'
typography:
  family: "Inter, system-ui, sans-serif"
  family-phonetic: "Inter, 'Charis SIL', 'Segoe UI', 'Noto Sans', sans-serif"
  title: '24px / 700'
  target-sentence: '20px / 600'
  bubble: '16px / 400'
  ui: '14px / 400'
  meta: '12px / 400'
  numerals: 'tabular-nums'
rounded:
  sm: 6px
  md: 12px
  lg: 16px
  full: 50%
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 24px
  '6': 32px
components:
  mic-button: '52px tròn, quầng sáng khi ghi'
  chat-bubble: 'rounded.md, lệch 4px ở góc phía người nói'
  hint-chip: 'rounded.full, viền mảnh, chữ meta'
  score-card: 'rounded.md, viền hairline, dính dưới lượt vừa nói'
---

## Brand & Style

Sản phẩm này là **phòng tập**, không phải bạn hội thoại. Nó tồn tại để người học lặp
một câu cho đến khi câu đó bật ra tự động — và để chỉ ra những âm mà tai họ không tự
nghe được. Mọi quyết định thị giác phục vụ một việc: **làm phản hồi đúng/sai rõ ngay
lập tức**, vì đó là thứ duy nhất người dùng thật sự đến đây để lấy.

Xanh lá là màu chủ đạo — trầm và nhẹ, không phải xanh chói của ứng dụng thể thao.
Người dùng điển hình mở app lúc 5h30 sáng, vừa ngủ dậy, nhà còn yên tĩnh. Màn hình
lúc đó không được hét vào mặt họ.

Không streak, không huy hiệu, không chuỗi ngày. Bằng chứng tiến bộ duy nhất là **con
số thời gian bật câu tụt xuống** và **số từ nói ra được tăng lên**. Ép người ta bằng
nỗi sợ mất chuỗi là mượn động lực, không phải tạo động lực.

## Colors

> Bản dựng năm hướng đã chọn từ đó: [mockups/palette-directions.html](mockups/palette-directions.html).
> Khi có mâu thuẫn, **tài liệu này thắng bản dựng**.

Hai chế độ đầy đủ, người dùng tự gạt trong app — không theo hệ điều hành, không tự
đổi theo giờ.

**Chế độ sáng** dùng khi luyện ban ngày. Nền xanh rất nhạt `#f4f8f2`, thẻ trắng.
**Chế độ tối** dùng buổi sớm và buổi tối. Nền `#0a120d` gần như đen ngả xanh.

Hai chế độ **cố ý mang tính cách khác nhau**: sáng thì điềm tĩnh và sạch, tối thì
đậm và tập trung.

Ba màu ngữ nghĩa mang toàn bộ nghĩa của sản phẩm:

| Vai | Sáng | Tối | Nghĩa |
|---|---|---|---|
| `success` | `#15803d` | `#4ade80` | **Đạt** — mọi âm của từ mục tiêu ≥ 30 điểm |
| `danger` | `#be123c` | `#fb7185` | **Chưa đạt** — có âm dưới 30 |
| `warning` | `#a16207` | `#fbbf24` | Lỗi tầng 2 — âm dưới 60 nhưng không chặn |

Mọi cặp màu/nền đều đạt tối thiểu **4,5:1** theo WCAG AA. Bảng sáng đã được làm trầm
xuống so với bản phác ban đầu vì ba màu đầu tiên đều trượt chuẩn.

Bảng màu tím `#7c3aed` và xanh dương `#3b82f6` của phiên bản cũ **bị bỏ**, cùng với
hai biến hiệu ứng phát sáng đi kèm.

## Typography

Một họ chữ duy nhất: **Inter**. Dấu tiếng Việt tốt, trung tính đủ để nhường chỗ cho
nội dung, và đã có sẵn trong dự án.

Câu tiếng Anh **không** dùng họ chữ khác — chỉ to hơn và đậm hơn. Hai họ chữ trên một
màn hình điện thoại sẽ rối và tốn thêm một lượt tải.

Số đo dùng `tabular-nums`. Đồng hồ đếm lên mà dùng số tỉ lệ sẽ **giật ngang** mỗi lần
đổi chữ số — ngay chỗ người dùng đang nhìn chăm chú nhất.

**Ký hiệu phiên âm cần font stack riêng.** Inter tải từ Google Fonts chỉ gồm `latin`
và `latin-ext`; khối IPA Extensions (`θ ð ʃ ɪ ə`) không nằm trong đó và sẽ rơi về font
hệ thống. Khai báo `family-phonetic` để việc rơi đó là có chủ đích chứ không phải tai nạn.

## Layout & Spacing

Bậc 4px: `4 · 8 · 12 · 16 · 24 · 32`. Không dùng giá trị ngoài bậc.

Thiết kế cho điện thoại trước. Màn hình buổi luyện là một cột: dải trạng thái trên
cùng, luồng chat cuộn ở giữa, hàng điều khiển dính đáy.

Hàng điều khiển đáy giữ nguyên vị trí ở mọi trạng thái — nút gợi ý bên trái, đồng hồ
ở giữa, nút mic bên phải. Người dùng đang tập trung vào việc nói; nút không được nhảy chỗ.

## Elevation & Depth

Phân lớp bằng **màu nền**, không bằng đổ bóng: `surface-base` → `surface-raised` →
`surface-sunken` cho khối chỉ dẫn lồng bên trong.

Một ngoại lệ duy nhất: **nút mic phát quầng sáng xanh khi đang ghi âm**. Đó là chỗ
duy nhất trong app cần hút mắt.

## Shapes

`sm 6px` chip và nhãn · `md 12px` bong bóng chat, thẻ điểm, khối chỉ dẫn ·
`lg 16px` bảng lớn và bảng tổng kết · `full` nút mic.

Bong bóng chat bo lệch còn `4px` ở góc phía người nói — quy ước quen thuộc, giúp phân
biệt vai mà không cần thêm nhãn.

## Components

**Nút mic** — 52px tròn, đáy phải. Bấm để bắt đầu, bấm lần nữa để dừng. Vô hiệu hoá
khi không phải lượt người dùng; **trạng thái vô hiệu chính là tín hiệu "chưa tới lượt
bạn"** — không có chỉ báo lượt riêng.

**Bong bóng chat** — lời thoại hệ thống căn trái trên `surface-raised`; lời người dùng
căn phải trên nền xanh nhạt hơn. Từ mục tiêu tô bằng `chrome`.

**Chip gợi ý** — bo tròn hoàn toàn, viền mảnh, chữ `meta`. Hai nấc: tình huống, rồi
từ khoá.

**Thẻ điểm** — dính ngay dưới lượt vừa nói. Dòng đầu là kết quả kèm thời gian. Bên
dưới là các từ mục tiêu dạng chip màu theo tầng.

**Đồng hồ** — chữ `20px`, `tabular-nums`, màu `chrome`. **Đếm lên, không đếm xuống.**
Nó là thước đo, không phải tối hậu thư. Không có giới hạn thời gian cho một lượt.

## Do's and Don'ts

**Nên**
- Cho mọi trạng thái một dấu hiệu **ngoài màu** — dấu tích, dấu chéo, gạch chân sóng,
  viền nét đứt. Bắt buộc, không phải trang trí.
- Giữ hàng điều khiển đáy cố định ở mọi trạng thái.
- Dùng `tabular-nums` cho mọi con số thay đổi liên tục.
- Đặt câu tiếng Anh ở cỡ `target-sentence` khi hiện đáp án — đó là nội dung quan trọng nhất.

**Không nên**
- Truyền đạt trạng thái **chỉ** bằng màu. Khoảng 1 trên 12 nam giới không phân biệt
  được đỏ và lục, mà tệp người dùng nghiêng về nam.
- Thêm streak, huy hiệu, hay chuỗi ngày.
- Dùng đổ bóng để phân lớp — trừ quầng sáng của nút mic.
- Đưa màu tím hay xanh dương của phiên bản cũ trở lại.
- Làm to chuyện một lần thất bại bằng hiệu ứng hay chuyển động mạnh.
