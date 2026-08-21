---
title: "Phòng tập phản xạ tiếng Anh"
status: draft
created: 2026-08-20
updated: 2026-08-20
---

# PRD: Phòng tập phản xạ tiếng Anh
*Tên đang dùng tạm — cần chốt. Không được đặt tên gắn với Anki.*

> **Bản thảo đang tiến hành.** Các mục hoàn thiện dần theo tiến trình trao đổi;
> quyết định và lý do được ghi trong `.memlog.md`.

## 0. Mục đích tài liệu

PRD này dành cho người viết UX, người thiết kế kiến trúc, và người bóc epic/story
sau đó. Nó xây trên [brief đã duyệt](../../briefs/brief-anki-english-app-2026-08-20/brief.md)
và phụ lục của brief — **không lặp lại** phần định vị, mô hình kinh doanh, hay cơ
sở nghiên cứu đã có ở đó. Chỗ nào PRD này khác brief thì PRD thắng, và khác biệt
được ghi rõ.

Cấu trúc: từ vựng chốt ở Từ điển thuật ngữ và dùng nguyên văn ở mọi mục sau; tính
năng gom nhóm với yêu cầu chức năng lồng bên trong, đánh số toàn cục; giả định gắn
nhãn tại chỗ và gom lại ở cuối.

## 2. Người dùng mục tiêu

### 2.3 Hành trình người dùng

**UJ-1. Sơn luyện phản xạ trước khi cả thành phố dậy.**

> Sơn, 27 tuổi, dev, đang nhắm vào công ty nước ngoài nên phải nói được tiếng Anh
> trong họp. 5h30 sáng, vừa ngủ dậy, nhà còn yên tĩnh — giờ duy nhất trong ngày
> không ai làm phiền.
>
> **Trạng thái vào:** đã đăng nhập từ trước, mở thẳng từ màn hình chính trên điện
> thoại.
>
> **Diễn tiến:**
> 1. Màn hình đầu là **những thẻ đến hạn luyện hôm nay**, mỗi thẻ kèm **số lần Sơn
>    đã nói ra được từ đó**. Anh lướt qua để nhớ mặt chữ trước khi vào buổi.
> 2. Bấm **Luyện tập** → chọn chủ đề → hệ thống sinh **kịch bản** chứa các từ đến hạn.
> 3. Bấm bắt đầu. Giao diện là khung chat: hệ thống nói lượt của nó, Sơn nói lượt
>    của mình. **Cảm giác như trò chuyện, nhưng mọi lượt của Sơn đều có câu đích.**
> 4. Mặc định Sơn **không thấy câu tiếng Anh** — phải tự bật ra. Bí thì mở **thang
>    gợi ý**: tình huống câu đó được dùng → từ khoá → cả câu.
> 5. Mỗi lượt Sơn nói được **chấm ngay trong luồng chat**, không đợi hết buổi.
>
> **Cao trào:** Sơn bật ra một câu chứa từ hôm qua còn phải mở gợi ý mới nhớ — lần
> này không cần gợi ý, và con số phản xạ hiện ra thấp hơn hôm qua.
>
> **Kết thúc:** Sơn bấm **Kết thúc buổi**, rồi xem bảng tổng kết.
>
> **Chỗ dễ bỏ cuộc:** nói mãi mà không đạt. Đây là rủi ro trải nghiệm số một của
> sản phẩm.

*(UJ-2 — lần đầu mở app — hoãn theo quyết định của người dùng: làm lõi trước.)*

## 3. Từ điển thuật ngữ

*Mọi mục sau dùng các thuật ngữ này **nguyên văn**. Không dùng từ đồng nghĩa ở bất
kỳ đâu trong tài liệu.*

- **Kịch bản** — Đoạn hội thoại hai vai do hệ thống sinh ra từ các **Thẻ đến hạn**
  và chủ đề người dùng chọn. Cố định sau khi sinh; mọi lời thoại đều biết trước.
- **Lượt** — Một lời thoại thuộc vai của người dùng trong **Kịch bản**. Đơn vị nhỏ
  nhất của việc luyện tập và của việc chấm điểm. Một **Kịch bản** chứa nhiều **Lượt**.
- **Câu đích** — Lời thoại đúng của một **Lượt**, hệ thống biết trước, người dùng
  không nhìn thấy.
- **Từ mục tiêu** — Từ vựng đến hạn được cài vào **Câu đích**. Một **Lượt** chứa
  tối đa 2 **Từ mục tiêu**.
- **Thang gợi ý** — Hai nấc người dùng có thể mở khi bí, theo thứ tự: (1) tình
  huống **Câu đích** được dùng, (2) từ khoá. **Không có nấc hiện cả câu** — người
  dùng không bao giờ được đưa câu để đọc.
- **Đạt** — Trạng thái của một **Lượt** khi **mọi âm vị của mọi Từ mục tiêu đạt từ 30
  điểm trở lên**. Chỉ tầng âm vị quyết định; điểm cấp từ và điểm tổng **không** tham
  gia — đo lường cho thấy chúng đi ngược chiều với chất lượng thật. Mở **Thang gợi ý**
  không làm mất trạng thái **Đạt**.
- **Nói ra được** — Một **Lượt** kết thúc ở trạng thái **Đạt**. Chỉ nói ra mà chưa
  **Đạt** thì không tính. Màn hình chính đếm số lần **Nói ra được** cho từng
  **Từ mục tiêu**.
- **Độ trễ bật câu (TTFW)** — Khoảng thời gian từ lúc hiện **Lượt** đến âm đầu tiên
  người dùng phát ra. **Chỉ ghi nhận ở những Lượt không mở Thang gợi ý.**
- **Thẻ đến hạn** — Từ vựng lịch giãn cách xếp vào buổi luyện của ngày hôm nay.
- **Trình độ** — Mức A2, B1 hoặc B2 người dùng chọn, quyết định độ khó của từ ngữ và
  cấu trúc câu trong **Kịch bản** (ngoài các **Từ mục tiêu**).

## 4. Tính năng

### 4.1 Nạp từ vựng từ Anki

**Description:** Người dùng chọn một deck Anki trên máy mình; hệ thống đọc thẻ qua
AnkiConnect và chuẩn hoá thành cặp từ–nghĩa để dùng làm **Từ mục tiêu**. Đây là
đường nạp duy nhất ở v1.

`[GIẢ ĐỊNH]` Người dùng đang chạy Anki Desktop kèm add-on AnkiConnect trên cùng máy
với trình duyệt. Ràng buộc này khiến **UJ-1 chưa dựng được trên điện thoại** — xem
§7 Nền tảng.

#### FR-1: Chọn deck và đọc thẻ
Người dùng chọn một deck trong danh sách deck lấy từ Anki, hệ thống đọc toàn bộ thẻ
trong deck đó.

**Consequences (testable):**
- Danh sách deck hiện trong vòng 2 giây khi Anki đang chạy.
- Khi Anki không chạy, hệ thống báo lỗi nói rõ nguyên nhân và cách khắc phục, không
  hiện màn hình trắng hay lỗi kỹ thuật.
- Thẻ thiếu mặt trước hoặc mặt sau bị loại, không làm hỏng cả lần nạp.

#### FR-2: Chuẩn hoá thành Từ mục tiêu
Hệ thống rút từ và nghĩa từ các trường của thẻ, bất kể deck dùng tên trường nào.

**Consequences (testable):**
- Thẻ có trường tên `Front`/`Back`, `Word`/`Meaning`, hoặc `English`/`Vietnamese`
  đều rút đúng.
- Thẻ dùng tên trường lạ thì lấy hai trường đầu tiên.
- Thẻ HTML được gỡ thẻ đánh dấu, chỉ giữ văn bản.

**Out of Scope:**
- Ghi ngược bất cứ thứ gì vào Anki. Chỉ đọc.

---

### 4.2 Màn hình chính — Thẻ đến hạn

**Description:** Màn hình đầu tiên sau khi mở app. Hiện những **Thẻ đến hạn** của
ngày hôm nay để người dùng lướt qua trước khi vào buổi luyện, mỗi thẻ kèm số lần
**Nói ra được**. Realizes UJ-1.

#### FR-3: Hiện Thẻ đến hạn hôm nay
Người dùng thấy danh sách **Thẻ đến hạn** ngay khi mở app, không cần thao tác nào.

**Consequences (testable):**
- Mỗi mục hiện từ, nghĩa, và số lần **Nói ra được**.
- Khi không có thẻ nào đến hạn, màn hình nói rõ điều đó và vẫn cho vào buổi luyện tự do.

#### FR-4: Đếm số lần Nói ra được
Với mỗi **Từ mục tiêu**, hệ thống hiện tổng số **Lượt** đã kết thúc ở trạng thái **Đạt**.

**Consequences (testable):**
- Chỉ **Lượt** **Đạt** làm tăng con số; **Lượt** chưa **Đạt** không tính.
- **Lượt** có mở **Thang gợi ý** vẫn tính, miễn là **Đạt**.
- **Lượt** được hiện đáp án (FR-12) **không** tính.

---

### 4.3 Sinh kịch bản

**Description:** Người dùng chọn một chủ đề; hệ thống sinh một **Kịch bản** hai vai
chứa các **Từ mục tiêu** đến hạn, kèm audio mẫu cho mọi lời thoại **và nội dung
Thang gợi ý cho từng Lượt**. Tất cả sinh một lần rồi lưu lại.

#### FR-5: Chọn chủ đề và trình độ
Người dùng chọn một chủ đề từ danh sách có sẵn và một **Trình độ** trước khi sinh
**Kịch bản**.

**Consequences (testable):**
- Chọn xong là sinh ngay, không thêm bước cấu hình nào.
- **Trình độ** chỉ chi phối phần ngôn ngữ ngoài **Từ mục tiêu**; từ vựng đến hạn luôn
  xuất hiện bất kể trình độ.
- Cả hai lựa chọn có giá trị mặc định để người dùng bấm thẳng vào luyện.

#### FR-6: Sinh Kịch bản chứa Từ mục tiêu
Hệ thống sinh **Kịch bản** đưa các **Từ mục tiêu** đến hạn vào **Câu đích** một cách
tự nhiên.

**Consequences (testable):**
- Mỗi **Lượt** chứa tối đa 2 **Từ mục tiêu**.
- **Kịch bản** có từ 5 đến 12 lời thoại, chia đều hai vai.
- Mọi **Từ mục tiêu** đến hạn của buổi đều xuất hiện ít nhất một lần.
- **Kịch bản** trả về dưới dạng dữ liệu có cấu trúc, không phải văn bản tự do.
- Nội dung **Thang gợi ý** của mọi **Lượt** được sinh **cùng lúc với Kịch bản** và
  lưu lại. Bấm mở gợi ý **không** gọi ra ngoài — người dùng đang bí, bắt họ đợi mạng
  ở đúng khoảnh khắc đó là tệ nhất.
- **Từ mục tiêu** kết thúc bằng `-ed`, `-s`, `-d`, `-t` **không** đứng ngay trước một
  từ bắt đầu bằng chính phụ âm đó. Người bản ngữ vốn nuốt âm cuối ở những chỗ như
  *"walked **to**"* hay *"cold **drink**"*, nên đặt từ vào đó thì không thể chấm được
  đuôi từ — đã kiểm chứng bằng đo lường.

#### FR-7: Sinh và lưu audio mẫu
Hệ thống sinh audio giọng bản ngữ cho mọi lời thoại trong **Kịch bản** và lưu lại
để dùng nhiều lần.

**Consequences (testable):**
- Audio chỉ sinh một lần cho mỗi **Kịch bản**; các buổi sau dùng lại bản đã lưu.
- Mở lại một **Kịch bản** cũ không phát sinh lời gọi sinh audio mới.

---

### 4.4 Buổi luyện

**Description:** Trái tim sản phẩm. Giao diện khung chat: hệ thống nói lượt của vai
nó, người dùng nói **Lượt** của vai mình. Cảm giác như trò chuyện, nhưng mọi **Lượt**
đều có **Câu đích** biết trước. Người dùng **không thấy** **Câu đích**. Realizes UJ-1.

#### FR-8: Hệ thống diễn lượt của nó
Hệ thống phát audio mẫu cho lời thoại thuộc vai của nó và hiện văn bản tương ứng.

**Consequences (testable):**
- Văn bản lời thoại của hệ thống luôn hiện; văn bản **Câu đích** của người dùng
  không bao giờ hiện, trừ khi FR-12 kích hoạt.

#### FR-9: Người dùng nói Lượt của mình
Người dùng ghi âm câu nói của mình cho **Lượt** hiện tại.

**Consequences (testable):**
- Ghi âm bắt đầu và dừng theo thao tác rõ ràng của người dùng.
- Bản ghi phát lại được ngay sau khi dừng.
- Bản ghi được giữ lại trên máy để so sánh về sau.

#### FR-10: Thang gợi ý
Người dùng mở **Thang gợi ý** khi bí, theo thứ tự cố định: tình huống, rồi từ khoá.

**Consequences (testable):**
- Nấc tình huống mô tả bối cảnh **Câu đích** được dùng, **không dịch sang tiếng Việt**.
- Nấc từ khoá hiện các **Từ mục tiêu** và không quá 2 từ nội dung khác.
- **Không có nấc nào hiện toàn bộ Câu đích.**
- Độ sâu gợi ý đã mở được ghi lại cho từng **Lượt**.

#### FR-11: Giới hạn số lần thử trong một buổi
Người dùng thử lại tối đa 3 lần cho mỗi **Lượt** trong cùng một buổi.

**Consequences (testable):**
- Sau lần thử thứ 3, hệ thống không cho thử tiếp trong buổi này.
- Giới hạn áp dụng cho từng **Lượt**, không phải cho cả **Kịch bản**.

`[GIẢ ĐỊNH]` Con số 3 lấy từ ràng buộc lặp giãn cách (2–3 lần mỗi buổi) trong phụ lục
brief. Chưa hiệu chỉnh trên người dùng thật.

#### FR-12: Hiện đáp án sau khi thử hết lượt
Khi người dùng đã thử 3 lần mà chưa **Đạt**, hệ thống hiện **Câu đích** kèm audio mẫu
và đánh dấu **Lượt** đó để lặp lại ở các buổi sau.

**Consequences (testable):**
- Kèm **một chỉ dẫn nhắm đúng âm vị đã hỏng** — nêu tên âm và một mẹo cấu âm cho người
  Việt. Chỉ dẫn là văn bản viết sẵn đóng gói theo ứng dụng, **không sinh động lúc chạy**:
  người dùng vừa thất bại ba lần, bắt họ đợi mạng lúc đó là tệ nhất.
- **Lượt** này ghi là **chưa Đạt** và không làm tăng số lần **Nói ra được**.
- **Từ mục tiêu** trong **Lượt** này được đánh dấu để FR-16 xếp lịch dày hơn.
- Người dùng đi tiếp được, không bao giờ bị kẹt.
- Người dùng **không** có nút tự bỏ qua trước khi hết 3 lần.

#### FR-13: Kết thúc buổi
Người dùng kết thúc buổi bằng một thao tác rõ ràng, bất kể còn **Lượt** chưa làm.

**Consequences (testable):**
- Kết thúc giữa chừng vẫn ghi nhận toàn bộ số liệu của các **Lượt** đã hoàn thành.
- Không bắt người dùng nói lời chào để thoát.

---

### 4.5 Chấm điểm tại chỗ

**Description:** Mỗi **Lượt** được chấm ngay trong luồng chat, không đợi hết buổi.
Đây là phản hồi người dùng cần để biết mình sai ở đâu mà sửa ngay lần thử sau.

#### FR-14: Chấm mỗi Lượt ngay sau khi nói
Hệ thống chấm phát âm cho **Lượt** vừa nói và hiện kết quả ngay tại vị trí đó trong
luồng chat.

**Consequences (testable):**
- Kết quả hiện trong vòng 3 giây kể từ khi dừng ghi âm.
- Kết quả gắn với đúng **Lượt**, không đẩy người dùng sang màn hình khác.
- Khi dịch vụ chấm lỗi, **Lượt** vẫn tiếp tục được và lỗi hiện rõ ràng.

#### FR-15: Phát hiện và hiện lỗi theo tầng
Hệ thống phân biệt ba tầng lỗi khi hiện kết quả, và **đọc điểm ở tầng âm vị** để
phát hiện lỗi nuốt phụ âm.

**Consequences (testable):**
- **Tầng 1 — Từ mục tiêu.** Hiện nổi bật nhất. **Lượt** không **Đạt** nếu từ đó trượt
  một trong hai cửa ở định nghĩa **Đạt**.
- **Tầng 2 — Lỗi đặc trưng người Việt trên từ bất kỳ** (nuốt phụ âm cuối, mất đuôi
  `-s`/`-ed`, giản lược cụm phụ âm): hiện nổi bật, **không** làm mất **Đạt**.
- **Tầng 3 — Từ chức năng** (mạo từ, giới từ): chỉ hiện khi mở phần chi tiết.
- Phát hiện tầng 1 và tầng 2 dựa trên **điểm từng âm vị**, không dựa trên điểm cấp từ
  cũng không dựa trên cờ lỗi do dịch vụ chấm trả về.

**Vì sao bắt buộc đọc tầng âm vị** — đo trên giọng người Việt thật, 2026-08-21:

| Câu | Đọc cẩn thận | **Cố tình nuốt âm cuối** |
|---|---|---|
| đuôi `-ed` | PronScore 86,0 | **92,8** |
| âm `/θ/` | PronScore 87,7 | **91,9** |

**Đọc cẩu thả được điểm cao hơn đọc cẩn thận ở 2 trên 3 câu.** Nguyên nhân: đọc cẩn
thận thì chậm và ngắt hơn, làm `Fluency` và `Prosody` tụt nhiều hơn phần được ở độ
chính xác. Chấm bằng điểm tổng sẽ **thưởng cho người nuốt âm và phạt người cố gắng**.

Điểm cấp từ cũng vô dụng: từ `walked` đạt **97 điểm cấp từ** trong khi âm `/t/` cuối
của nó là **0**. Cờ lỗi của dịch vụ trả về `None` cho chính từ đó.

**Hai ngưỡng, hiệu chỉnh trên giọng người Việt thật ngày 2026-08-21** (9 bản thu, ba
cách đọc, 17 âm vị cuối mục tiêu):

| Ngưỡng | Dùng cho | Hành vi |
|---|---|---|
| **< 30** | Tầng 1 | Âm gần như không phát ra → **chặn Đạt** |
| **< 60** | Tầng 2 | Âm có nhưng yếu → **cảnh báo, không chặn** |

Bằng chứng: không lần đọc cẩn thận nào rơi dưới 30 (thấp nhất 35); lỗi nuốt cố ý rơi
vào 0–5; giọng nói bình thường chặn đúng ba chỗ thật sự mất âm (0, 16, 16) và không
chặn những chỗ yếu-nhưng-có (57, 64, 67, 71). Nâng lên 70 khiến 71% âm cuối trong giọng
nói bình thường bị chặn — quá khắt khe. Nâng lên 80 làm 60% lần đọc cẩn thận trượt oan.

#### FR-16: Nghe lại và tự so sánh
Người dùng nghe lại bản thu của mình cạnh audio mẫu, không giới hạn số lần.

**Consequences (testable):**
- Nghe lại **không** gọi dịch vụ chấm và **không** trừ hạn mức nào.
- Dùng được cho mọi **Lượt** đã nói trong buổi.

---

### 4.6 Đo lường

**Description:** Hai chỉ số sản phẩm sống bằng, thu thập lặng lẽ trong lúc luyện.

#### FR-17: Đo Độ trễ bật câu
Hệ thống đo khoảng thời gian từ lúc hiện **Lượt** đến âm đầu tiên người dùng phát ra.

**Consequences (testable):**
- Chỉ ghi nhận khi **Lượt** đó **không mở Thang gợi ý** nào.
- Đo tại máy từ dạng sóng, không gọi dịch vụ ngoài.
- **Lượt** có mở gợi ý bị bỏ khỏi chuỗi số liệu, không ghi giá trị thay thế.

#### FR-18: Ghi nhận độ sâu gợi ý
Hệ thống ghi lại người dùng đã mở đến nấc nào của **Thang gợi ý** cho từng **Lượt**.

**Consequences (testable):**
- Ba trạng thái phân biệt được: không gợi ý, mở tình huống, mở từ khoá.

---

### 4.7 Tổng kết buổi

**Description:** Sau khi kết thúc, người dùng thấy buổi vừa rồi nói lên điều gì.

#### FR-19: Bảng tổng kết
Người dùng xem tổng kết ngay sau khi kết thúc buổi.

**Consequences (testable):**
- Hiện: số **Lượt** **Đạt** trên tổng số, **Từ mục tiêu** nào **Nói ra được** lần đầu,
  **Lượt** nào phải hiện đáp án.
- Hiện **Độ trễ bật câu** trung bình của buổi, so với buổi trước.
- Khi buổi không có **Lượt** nào không-gợi-ý, phần độ trễ nói rõ là chưa đủ dữ liệu
  thay vì hiện số 0 hoặc bỏ trống.

---

### 4.8 Lịch giãn cách

**Description:** Quyết định **Từ mục tiêu** nào thành **Thẻ đến hạn** của ngày nào.
Đây là thứ khiến việc lặp lại trải ra nhiều buổi thay vì dồn vào một buổi.

#### FR-20: Xếp lịch Thẻ đến hạn
Hệ thống chọn tập **Từ mục tiêu** đến hạn cho mỗi ngày.

**Consequences (testable):**
- **Từ mục tiêu** kết thúc buổi ở trạng thái **Nói ra được** thì khoảng cách tới lần
  sau tăng theo bậc: **1 → 3 → 7 → 14 ngày**.
- **Từ mục tiêu** thuộc **Lượt** phải hiện đáp án (FR-12) quay lại **ngày hôm sau** và
  tụt về bậc đầu tiên.
- Một **Từ mục tiêu** không xuất hiện quá một buổi trong cùng một ngày.
- Tối đa **20 Thẻ đến hạn** mỗi buổi — trùng với giới hạn từ mục tiêu mỗi **Kịch bản**.
  Khi quá tải, ưu tiên từ đã từng trượt trước từ chưa bao giờ trượt.
- Trạng thái lưu cho mỗi **Từ mục tiêu**: bậc hiện tại, ngày đến hạn, số lần
  **Nói ra được**, số lần phải hiện đáp án.

Đây **không** phải thuật toán ghi nhớ cạnh tranh Anki — nó chỉ xếp lịch **Lượt** drill.
Bốn bậc cố định, không có hệ số dễ/khó, không tự điều chỉnh.

#### FR-21: Ưu tiên Lượt chưa Đạt
**Từ mục tiêu** thuộc **Lượt** phải hiện đáp án quay lại sớm hơn và dày hơn
**Từ mục tiêu** đã **Nói ra được**.

**Consequences (testable):**
- Từ bị hiện đáp án xuất hiện lại trong vòng vài ngày, không phải vài tuần.
- Việc lặp thêm diễn ra ở **các buổi sau**, không phải bằng cách tăng số lần thử
  trong buổi hiện tại.

---

## 5. Không làm (rõ ràng)

- **Không hội thoại AI tự do.** Mọi **Lượt** đều có **Câu đích**. Bỏ điều này là bỏ
  luôn khả năng chấm chính xác và đo phản xạ.
- **Không dạy từ mới.** Từ vựng đến từ deck người dùng đã học.
- **Không xây thuật toán ghi nhớ cạnh tranh Anki.** Lịch giãn cách ở đây chỉ xếp
  **Lượt** drill, không thay Anki ở việc ghi nhớ.
- **Không ghi bất cứ thứ gì ngược vào Anki.**
- **Không hứa cải thiện ngữ pháp.** Bằng chứng chỉ ủng hộ tốc độ và phát âm.
- **Không chấm luyến láy (nối âm).** Không có chỉ số đáng tin, và chấm theo âm vị rời
  rạc có thể trừ điểm người nói đúng.

## 6. Phạm vi MVP

### 6.1 Trong phạm vi
F1–F8 ở §4.

### 6.2 Ngoài phạm vi MVP
- **Bài kiểm tra mù** — công cụ đo *sản phẩm có hiệu quả không*, không phải thứ làm
  sản phẩm chạy. `[NOTE FOR PM]` Hoãn nó là hoãn luôn việc biết rủi ro đỏ số một
  trong brief đúng hay sai. Đưa lại ngay khi vòng lặp lõi ổn định.
- **Thanh toán và hạn mức lượt chấm** — chưa có người dùng trả tiền thì chưa cần.
  Giai đoạn này chạy trên bậc miễn phí.
- **Nạp từ bằng dán/tải file** — hoãn, nhưng nó chặn UJ-1 (xem §7).
- **Tài khoản và đồng bộ đa thiết bị.**
- **Trải nghiệm lần đầu** — màn hình chào, dẫn dắt, đăng ký.
- **Giữ bản ghi qua nhiều buổi** để nghe lại và đối chiếu tiến bộ dài hạn. v1 chỉ giữ
  bản ghi **trong một buổi**; hết buổi là mất. `[NOTE FOR PM]` Hoãn chứ không bỏ —
  brief ghi đây là bằng chứng tiến bộ tốn 0đ.
- **Màn hình tiến bộ dài hạn.** `[NOTE FOR PM]` Hệ quả: **Độ trễ bật câu** giảm dần theo
  tuần — chỉ số Bắc Đẩu — không hiển thị cho người dùng ở v1. Họ chỉ thấy so sánh với
  buổi liền trước.

## 7. Nền tảng

Mục tiêu là **web trên điện thoại (PWA)**. Nhưng v1 đọc từ vựng qua AnkiConnect, vốn
chỉ chạy ở `localhost` trên máy tính bàn.

> **Hệ quả:** giai đoạn này phát triển và tự kiểm thử trên desktop. **UJ-1 là trạng
> thái mục tiêu, chưa phải thứ chạy được.** Muốn kiểm chứng UJ-1 phải có đường nạp từ
> bằng file hoặc dán trước.

Không đặt tên sản phẩm gắn với Anki — nguồn từ vựng sẽ thay đổi.

## 8. Ràng buộc và lan can

### 8.1 Chi phí
- Chấm phát âm tính tiền theo giây audio. Cắt khoảng lặng đầu/cuối trước khi gửi.
- Audio mẫu và **Kịch bản** sinh một lần rồi dùng lại; không sinh lại khi mở lại.
- Nghe lại và tự so sánh chạy hoàn toàn tại máy, không tốn phí.
- **Giới hạn 3 lần thử mỗi Lượt vừa là ràng buộc sư phạm vừa là lan can chi phí.**
  Bỏ nó thì mô hình giá trong brief vỡ.

### 8.2 Riêng tư
- Giọng nói người dùng rời khỏi máy để đi chấm. Phải nói rõ điều này với người dùng.
- Bản ghi của người dùng lưu tại máy, không tải lên máy chủ nào để lưu trữ.

## 9. Yêu cầu phi chức năng xuyên suốt

- Kết quả chấm hiện trong 3 giây kể từ khi dừng ghi âm.
- Mỗi clip gửi đi chấm không quá 30 giây — kéo theo việc chấm phải theo từng **Lượt**.
- Audio thu ở dạng PCM 16 kHz, 16-bit, mono.
- Mất mạng giữa buổi không làm mất số liệu các **Lượt** đã hoàn thành.
- Bản ghi âm và số liệu tiến bộ lưu ở kho cục bộ chịu được dung lượng audio.

## 10. Thước đo thành công

**Chính**
- **SM-1**: **Độ trễ bật câu** trung bình giảm dần theo tuần. Kiểm chứng FR-17.
- **SM-2**: Tỷ lệ **Lượt** **Đạt** mà **không mở Thang gợi ý** tăng dần. Kiểm chứng
  FR-10, FR-18.

**Phụ**
- **SM-3**: Số **Từ mục tiêu** đạt trạng thái **Nói ra được** lần đầu mỗi tuần.
  Kiểm chứng FR-4.
- **SM-4**: Số ngày luyện trong tuần.

**Phản chỉ số (không được tối ưu)**
- **SM-C1**: Số lần thử mỗi buổi. Tăng chỉ số này nghĩa là người dùng đang chật vật
  hoặc bị ép cày, không phải đang tiến bộ. Đối trọng với SM-3.
- **SM-C2**: Tỷ lệ **Đạt**. Có thể bơm lên bằng cách hạ ngưỡng chấm. Đối trọng với SM-2.
- **SM-C3**: Thời lượng mỗi buổi. Buổi dài hơn không tốt hơn — lặp dồn làm hỏng phát âm.

## 11. Câu hỏi còn mở

1. ~~Ngưỡng **Đạt** đặt ở đâu?~~ **Đã đóng 2026-08-21.** Hiệu chỉnh trên giọng người
   Việt thật: chặn ở **âm vị < 30**, cảnh báo ở **< 60**. Ngưỡng cấp từ trong brief bị
   bác bỏ bằng số liệu.
2. ~~Thuật toán xếp lịch giãn cách (FR-20)~~ **Đã chốt 2026-08-20:** bậc cố định
   1/3/7/14 ngày, trượt thì về ngày mai và về bậc đầu.
3. Biểu đồ tiến bộ xử lý thế nào khi tuần đầu gần như không có số liệu **Độ trễ bật
   câu**, và khi các **Lượt** khó dần lọt vào nhóm không-gợi-ý làm trung bình xấu đi
   vì lý do chọn mẫu?
4. Giọng và diện mạo sản phẩm — chưa bàn.
5. Buổi luyện dài bao nhiêu **Lượt** là vừa?

## 12. Chỉ mục giả định

- §4.1 — Người dùng chạy Anki Desktop kèm AnkiConnect cùng máy với trình duyệt.
- §4.4 FR-11 — Giới hạn 3 lần thử mỗi **Lượt**; suy từ ràng buộc lặp giãn cách, chưa
  hiệu chỉnh.
- §4.4 FR-12 — Hiện đáp án sau đúng 3 lần chưa **Đạt**; con số do tôi đề xuất, anh
  chưa xác nhận.
- §4.5 FR-15 — Ngưỡng 30/60 hiệu chỉnh trên **một người nói, 9 bản thu**. Cần kiểm lại
  khi có thêm người dùng.
- §8 — Chưa thử tắt khử ồn của trình duyệt; cả 9 bản thu hiệu chỉnh đều bật.
