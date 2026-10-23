import { useEffect, useRef, useState } from 'react';
import { safeFileName } from '../lib/download';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

export type SaveFormat = 'pdf' | 'xml';

interface Props {
  format: SaveFormat;
  initialName: string;
  onCancel: () => void;
  onSave: (name: string) => void;
}

const LABEL: Record<SaveFormat, string> = { pdf: 'Tải PDF', xml: 'Tải XML' };

/** Asks for the file name before downloading (bottom sheet on phones, dialog on desktop). */
export function SaveDialog({ format, initialName, onCancel, onSave }: Props) {
  const [name, setName] = useState(initialName);
  const input = useRef<HTMLInputElement>(null);
  const finalName = safeFileName(name);
  const adjusted = name.trim() !== '' && finalName !== name.trim().replace(/\.(pdf|xml)$/i, '');

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const submit = () => onSave(finalName);

  return (
    <Sheet
      title={LABEL[format]}
      onClose={onCancel}
      footer={
        <>
          <button className="btn block" onClick={onCancel}>
            Hủy
          </button>
          <button className="btn primary block" onClick={submit}>
            <Icon name="download" size={16} /> Tải xuống
          </button>
        </>
      }
    >
      <form
        className="save-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="save-name">Tên file</label>
        <div className="save-field">
          <input
            id="save-name"
            ref={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="tai-lieu"
            spellCheck={false}
            autoComplete="off"
            enterKeyHint="done"
          />
          <span className="save-ext">.{format}</span>
        </div>
        <p className="save-hint">
          {name.trim() === ''
            ? `Để trống sẽ dùng tên “${finalName}.${format}”.`
            : adjusted
              ? `Sẽ lưu thành “${finalName}.${format}” (các ký tự \\ / : * ? " < > | không dùng được trong tên file).`
              : `File sẽ được lưu vào thư mục Tải xuống của trình duyệt.`}
        </p>
      </form>
    </Sheet>
  );
}
