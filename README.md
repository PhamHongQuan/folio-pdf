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

## Định dạng XML

```xml
<PdfDocument pageCount="…">
  <Metadata>…</Metadata>
  <Sources><Source id="1" fileName="…" sha256="…"/></Sources>
  <Pages>
    <Page number="1" sourceId="1" sourcePage="3" width="595.28" height="841.89" rotation="0" hasText="true">
      <Lines><Line y="780">PHIẾU THU SỐ 0001</Line>…</Lines>
      <TextItems>…</TextItems>            <!-- tùy chọn: tọa độ từng cụm chữ -->
    </Page>
  </Pages>
  <EmbeddedPdf encoding="base64" sha256="…">…</EmbeddedPdf>   <!-- tùy chọn: bản PDF đầy đủ -->
</PdfDocument>
```

`Lines` được dựng từ vị trí chữ trong PDF. Văn bản được trích xuất đúng như PDF lưu trữ;
PDF dạng ảnh scan sẽ có `hasText="false"` (không có OCR). `EmbeddedPdf` chứa chính xác file PDF đã xuất
(cùng SHA-256), nên XML luôn mang theo bản gốc không mất mát.

## Cấu trúc

```
src/
  App.tsx                 # Giao diện, lịch sử hoàn tác, xuất file
  components/             # PageCard, PageCanvas (thumbnail), PreviewModal, Icon
  lib/pdf.ts              # Đọc PDF, dựng PDF mới, kiểm tra toàn vẹn
  lib/xml.ts              # Xuất XML
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
