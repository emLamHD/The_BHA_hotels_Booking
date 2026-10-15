/** Hands a text to the browser as a file (an exported language pack, a translator template). Nothing is sent anywhere. */
export function downloadText(filename: string, text: string, type = "application/json;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
