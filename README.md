# Folio — PDF Page Organizer

Web app giúp thủ quỹ siêu thị sắp xếp trang PDF ngay trên trình duyệt:

- Tải lên một hoặc nhiều file PDF (kéo thả hoặc chọn file)
- **Kéo thả** trang để đổi vị trí (kéo được cả nhóm trang đã chọn), **xóa trang**, xoay trang
- Bấm để chọn trang (Shift: chọn dải); thanh thao tác nổi: Xoay · Lên đầu · Xuống cuối · Xóa
- Hoàn tác / Làm lại (Ctrl+Z / Ctrl+Y), phím Delete để xóa
- Giao diện sáng / tối (mặc định theo hệ điều hành, ghi nhớ lựa chọn)
- Tải về dạng **PDF** hoặc **XML**
- Nếu PDF có file đính kèm (ví dụ XML hóa đơn điện tử), có thể tải nguyên bản file đó

## Không làm sai lệch dữ liệu

- File **không được tải lên máy chủ** và không có database: mọi xử lý chạy trên trình duyệt.
- Trang được **sao chép nguyên vẹn** bằng `pdf-lib` (content stream, font, hình ảnh giữ nguyên byte),
  không render lại thành ảnh, không chuyển đổi chữ.
- Trước khi cho tải xuống, app **tự kiểm tra toàn vẹn** từng trang của file xuất ra so với file gốc:
  nội dung trang (so từng byte), văn bản và vị trí chữ, kích thước trang, góc xoay.
  Nếu có bất kỳ sai khác nào, file **không được tải xuống**.
- Metadata (tiêu đề, tác giả…) lấy từ file gốc đầu tiên được dùng.
- File PDF có mật khẩu bị từ chối (không xử lý được mà không giải mã).

Giới hạn: bookmark (outline) và form tương tác cấp tài liệu không được chuyển sang file mới;
nội dung hiển thị của trang (kể cả giá trị đã điền trong form) vẫn giữ nguyên.

## Định dạng XML (Aspose APS)

Nút **Tải XML** xuất theo định dạng APS của Aspose (giống công cụ PDF → XML của Aspose):

```xml
<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<Aps>
  <Group>
    <Page Width="595" Height="842" PaperTray="0">
      <Canvas><Canvas>
        <Clip>…khung trang…</Clip>
        <Canvas RenderTransform="a b c d e f">
          <Image ResourceId="1"><Origin X="0" Y="0" /><Size Width="1916" Height="2556" /></Image>
        </Canvas>
        …
      </Canvas></Canvas>
    </Page>
  </Group>
  <Resources><Resource Id="1">…base64…</Resource></Resources>
</Aps>
```

- Toạ độ tính bằng point, gốc ở góc trên-trái; UTF-8 có BOM, xuống dòng CRLF, thụt lề tab.
- Ảnh JPEG được nhúng **nguyên bản byte gốc** trong PDF (không nén lại); ảnh khác lưu PNG không mất dữ liệu.
  Ảnh trùng nội dung chỉ lưu một lần.
- Liên kết (Hyperlink) gắn vào ảnh nằm dưới vùng liên kết, đường kẻ/hình vẽ là `Path`, chữ là `Glyphs`.
- Đã đối chiếu với file Aspose thật (PDF scan 9 trang): phần cấu trúc trùng khớp từng byte.
  Phần biểu diễn chữ/hình vẽ cho PDF có chữ được suy ra theo cùng phong cách (chưa có mẫu Aspose để đối chiếu).

Lưu ý: đây là XML mô tả bố cục trang, **không phải** XML hóa đơn điện tử theo chuẩn của Tổng cục Thuế.

## Cấu trúc

```
src/
  App.tsx                 # Giao diện, lịch sử hoàn tác, xuất file
  components/             # PageCard, PageCanvas (thumbnail), PreviewModal, Sheet, Icon
  lib/pdf.ts              # Đọc PDF, dựng PDF mới, kiểm tra toàn vẹn
  lib/aps.ts              # Xuất XML định dạng Aspose APS
  lib/sensors.ts          # Kéo thả cảm ứng (tay cầm ⠿ / nhấn giữ)
api/health.py             # Python serverless function (Vercel) – GET /api/health
scripts/copy-pdfjs-assets.mjs  # Copy font/cmap của pdf.js vào public/ (tự chạy khi dev/build)
```

## Chạy local

```bash
npm install
npm run dev
```

Mở http://localhost:5173. Để chạy cả Python function local: `npx vercel dev`.

## Deploy Vercel

1. Đẩy code lên GitHub, rồi **Import Project** trên vercel.com (framework tự nhận Vite theo `vercel.json`), hoặc
2. Dùng CLI: `npx vercel` (preview) / `npx vercel --prod` (production).

Không cần biến môi trường. `api/health.py` chỉ dùng thư viện chuẩn của Python.
