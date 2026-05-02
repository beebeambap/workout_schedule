// Renders a DOM node to JPG and triggers download.
export async function exportJPG(node, filename) {
  document.body.classList.add('exporting');
  try {
    const canvas = await html2canvas(node, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true
    });
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    document.body.classList.remove('exporting');
  }
}
