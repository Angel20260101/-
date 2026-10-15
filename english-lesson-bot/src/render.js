function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const S = {
  body: 'margin:0;padding:24px 12px;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC",Helvetica,Arial,sans-serif;color:#1f2328;line-height:1.65;',
  card: 'max-width:680px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px 26px;border:1px solid #e3e5e8;',
  h1: 'margin:0 0 4px;font-size:22px;line-height:1.35;color:#111418;',
  meta: 'margin:0 0 22px;font-size:13px;color:#6b7280;',
  h2: 'margin:28px 0 10px;font-size:16px;color:#111418;border-bottom:2px solid #f0f1f3;padding-bottom:6px;',
  p: 'margin:0 0 12px;font-size:15px;',
  native: 'margin:0 0 12px;font-size:14px;color:#4b5563;',
  table: 'width:100%;border-collapse:collapse;font-size:14px;',
  th: 'text-align:left;padding:8px 10px;background:#f7f8f9;border:1px solid #e3e5e8;font-weight:600;white-space:nowrap;',
  td: 'padding:8px 10px;border:1px solid #e3e5e8;vertical-align:top;',
  word: 'padding:8px 10px;border:1px solid #e3e5e8;vertical-align:top;font-weight:600;white-space:nowrap;',
  ex: 'color:#6b7280;font-style:italic;',
  qa: 'margin:0 0 14px;padding:12px 14px;background:#f7f8f9;border-radius:8px;border:1px solid #eceef0;',
  footer: 'margin:26px 0 0;padding-top:16px;border-top:1px solid #f0f1f3;font-size:12px;color:#9ca3af;',
  link: 'color:#1a56db;',
};

export function renderHtml({ episode, lesson, podcastTitle, hasAudio }) {
  const published = episode.publishedAt
    ? episode.publishedAt.toISOString().slice(0, 10)
    : '';

  const vocabRows = lesson.vocabulary.map((v) => `
          <tr>
            <td style="${S.word}">${esc(v.word)}${v.partOfSpeech ? `<br><span style="font-weight:400;font-size:12px;color:#9ca3af;">${esc(v.partOfSpeech)}</span>` : ''}</td>
            <td style="${S.td}">${esc(v.meaningNative)}${v.meaningEn ? `<br><span style="font-size:13px;color:#6b7280;">${esc(v.meaningEn)}</span>` : ''}${v.example ? `<br><span style="${S.ex}">“${esc(v.example)}”</span>` : ''}</td>
          </tr>`).join('');

  const phraseRows = lesson.phrases.map((p) => `
          <tr>
            <td style="${S.word}">${esc(p.phrase)}</td>
            <td style="${S.td}">${esc(p.meaningNative)}${p.example ? `<br><span style="${S.ex}">“${esc(p.example)}”</span>` : ''}</td>
          </tr>`).join('');

  const questions = lesson.questions.map((q, i) => `
        <div style="${S.qa}">
          <div style="font-weight:600;margin-bottom:6px;">Q${i + 1}. ${esc(q.question)}</div>
          <div style="font-size:14px;color:#4b5563;">A. ${esc(q.answer)}</div>
        </div>`).join('');

  const section = (title, inner) => (inner ? `<h2 style="${S.h2}">${title}</h2>${inner}` : '');

  return `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${S.body}">
  <div style="${S.card}">
    <h1 style="${S.h1}">${esc(lesson.topic)}</h1>
    <p style="${S.meta}">
      ${esc(podcastTitle)}${published ? ` · ${esc(published)}` : ''}${episode.durationText ? ` · ${esc(episode.durationText)}` : ''}<br>
      ${esc(episode.title)}
      ${episode.link ? `<br><a href="${esc(episode.link)}" style="${S.link}">收聽原始集數 →</a>` : ''}
    </p>

    ${section('📝 本集摘要', `
      ${lesson.summaryEn ? `<p style="${S.p}">${esc(lesson.summaryEn)}</p>` : ''}
      ${lesson.summaryNative ? `<p style="${S.native}">${esc(lesson.summaryNative)}</p>` : ''}`)}

    ${section('📚 單字表', vocabRows ? `
      <table style="${S.table}" role="presentation">
        <tr><th style="${S.th}">單字</th><th style="${S.th}">意思與例句</th></tr>${vocabRows}
      </table>` : '')}

    ${section('💬 常用片語', phraseRows ? `
      <table style="${S.table}" role="presentation">
        <tr><th style="${S.th}">片語</th><th style="${S.th}">意思與例句</th></tr>${phraseRows}
      </table>` : '')}

    ${section('🧠 理解測驗', questions)}

    ${section('🔊 語音講解', hasAudio
      ? `<p style="${S.p}">本信附上 <strong>lesson.mp3</strong>，是本課的英語講解錄音，通勤時可以直接聽。</p>`
      : `<p style="${S.native}">本週語音合成未成功（通常是 ElevenLabs 額度用完），以下是講解稿，可自行朗讀：</p>${lesson.audioScript ? `<p style="${S.p}">${esc(lesson.audioScript)}</p>` : ''}`)}

    <p style="${S.footer}">由 english-lesson-bot 自動產生 · 每週日寄出</p>
  </div>
</body>
</html>`;
}

export function renderText({ episode, lesson, podcastTitle }) {
  const lines = [
    lesson.topic,
    '='.repeat(Math.min(lesson.topic.length, 60)),
    `${podcastTitle} — ${episode.title}`,
    episode.link ? `收聽：${episode.link}` : '',
    '',
  ];

  if (lesson.summaryEn) lines.push('【摘要】', lesson.summaryEn, '');
  if (lesson.summaryNative) lines.push(lesson.summaryNative, '');

  if (lesson.vocabulary.length) {
    lines.push('【單字表】');
    for (const v of lesson.vocabulary) {
      lines.push(`- ${v.word}${v.partOfSpeech ? ` (${v.partOfSpeech})` : ''}: ${v.meaningNative}`);
      if (v.example) lines.push(`    e.g. ${v.example}`);
    }
    lines.push('');
  }

  if (lesson.phrases.length) {
    lines.push('【常用片語】');
    for (const p of lesson.phrases) {
      lines.push(`- ${p.phrase}: ${p.meaningNative}`);
      if (p.example) lines.push(`    e.g. ${p.example}`);
    }
    lines.push('');
  }

  if (lesson.questions.length) {
    lines.push('【理解測驗】');
    lesson.questions.forEach((q, i) => {
      lines.push(`Q${i + 1}. ${q.question}`, `A. ${q.answer}`);
    });
    lines.push('');
  }

  if (lesson.audioScript) lines.push('【語音講解稿】', lesson.audioScript, '');

  return lines.filter((l) => l !== undefined).join('\n');
}
