const MAX_CHARS = 20000;

function truncate(text: string): string {
  const t = text.trim();
  if (t.length <= MAX_CHARS) return t;
  return t.slice(0, MAX_CHARS) + "\n\n（長いため、ここまでで区切っています）";
}

// PDF/Word/Excel/テキストの中身をサーバー側でその場で抽出する。
// 画像や未対応の形式は null を返す（呼び出し側が「まだ読めない」と伝える）。
export async function extractAttachmentText(a: {
  name: string;
  mime: string;
  data: string;
}): Promise<string | null> {
  const buf = Buffer.from(a.data, "base64");

  try {
    if (a.mime === "application/pdf") {
      // pdf-parse のパッケージ本体（index.js）はdebugモードでテスト用PDFを
      // 読みに行くバグがあるため、実体のlib実装を直接importして回避する
      const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
      const result = await pdfParse(buf);
      return result.text ? truncate(result.text) : null;
    }

    if (
      a.mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const mammoth = (await import("mammoth")).default;
      const result = await mammoth.extractRawText({ buffer: buf });
      return result.value ? truncate(result.value) : null;
    }

    if (
      a.mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      a.mime === "application/vnd.ms-excel"
    ) {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buf, { type: "buffer" });
      const parts = wb.SheetNames.map((name) => {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
        return `[シート: ${name}]\n${csv}`;
      });
      return parts.length ? truncate(parts.join("\n\n")) : null;
    }

    if (a.mime === "text/plain" || a.mime === "text/csv") {
      return truncate(buf.toString("utf-8"));
    }

    return null;
  } catch {
    // 壊れたファイル・パスワード付きPDF等。読めなかった扱いにフォールバック
    return null;
  }
}
