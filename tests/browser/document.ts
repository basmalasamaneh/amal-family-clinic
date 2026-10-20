import { messages, type Locale } from "./resources";

export function documentHtml(locale: Locale) {
  const m = messages[locale];
  return `<!doctype html><html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${m.title}</title>
<style>
:root { color-scheme: light dark; font-family: Arial, sans-serif; color: #172333; background: #f3f6fa; }
* { box-sizing: border-box; }
body { margin: 0; padding-block: 48px; padding-inline: 48px; }
main { max-inline-size: 720px; margin-inline: auto; padding: 32px; background: white; border: 2px solid #65758b; border-radius: 12px; }
h1 { margin-block-start: 0; } p { line-height: 1.6; }
label { display: block; margin-block-end: 8px; }
input, button { font: inherit; padding-block: 12px; padding-inline: 16px; border: 2px solid #526176; border-radius: 6px; }
input { color: inherit; background: transparent; inline-size: 100%; }
button { margin-block-start: 20px; background: #123c63; color: white; cursor: pointer; }
:focus-visible { outline: 3px solid #986000; outline-offset: 4px; }
footer { margin-block-start: 24px; text-align: center; }
@media(prefers-color-scheme:dark) {
 :root { color: #f2f5fa; background: #101b29; }
 main { background: #1c2d40; border-color: #a4b4c9; }
 input { border-color: #a4b4c9; }
 button { background: #c5e2ff; color: #102a44; }
 :focus-visible { outline-color: #ffda85; }
}
</style></head><body>
<main><h1>${m.heading}</h1><p>${m.description}</p>
<label for="example">${m.label}</label><input id="example" value="${m.value}">
<button type="button">${m.button}</button><p role="status" aria-live="polite">${m.online}</p></main>
<footer>${m.footer}</footer>
<script>
const status = document.querySelector('[role="status"]');
document.querySelector('button').addEventListener('click', async () => {
  try {
    const response = await fetch('/probe', { cache: 'no-store' });
    if (!response.ok) throw new Error('probe');
    status.textContent = ${JSON.stringify(m.online)};
  } catch { status.textContent = ${JSON.stringify(m.offline)}; }
});
</script></body></html>`;
}
