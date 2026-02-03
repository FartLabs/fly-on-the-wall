export function exportNoteHtml(note: any): string {
  const styles = `
    body { font-family: Arial, Helvetica, sans-serif; padding: 20px; }
    h1 { font-size: 18px; }
    h2 { font-size: 14px; margin-top: 18px; }
    pre { white-space: pre-wrap; background: #f7f7f7; padding: 12px; border-radius: 6px; }
  `;

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${note.id}</title>
        <style>${styles}</style>
      </head>
      <body>
        <h1>${note.id}</h1>
        <p>Created: ${note.created}</p>
        
        <h2>Transcription</h2>
        <pre>${note.transcription || ""}</pre>
        
        <h2>Summary</h2>
        <pre>${note.summary || ""}</pre>
      </body>
    </html>
  `;
}
