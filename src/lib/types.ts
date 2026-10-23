import type { PDFDocument } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface Attachment {
  filename: string;
  content: Uint8Array;
}

/** A PDF file the user uploaded. Its bytes are never modified. */
export interface SourceDoc {
  id: string;
  /** 1-based display index, used in labels and XML. */
  index: number;
  name: string;
  size: number;
  bytes: Uint8Array;
  sha256: string;
  pageCount: number;
  /** pdf-lib handle, used to copy pages verbatim into the output. */
  lib: PDFDocument;
  /** pdf.js handle, used for thumbnails and text extraction. */
  view: PDFDocumentProxy;
  attachments: Attachment[];
}

/** One page in the working layout, pointing at a page of a source file. */
export interface PageItem {
  key: string;
  docId: string;
  /** 0-based page index inside the source file. */
  pageIndex: number;
  /** Extra clockwise rotation chosen by the user (0/90/180/270). */
  rotation: number;
}
