/** Browser-side HTTP helpers shared by upload and API-driven views. */
export async function requestJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

export function uploadFile(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      let payload = {};
      try { payload = JSON.parse(request.responseText); } catch { /* Keep the HTTP fallback below. */ }
      if (request.status < 300) resolve(payload);
      else reject(new Error(payload.error || "Upload failed"));
    };
    request.onerror = () => reject(new Error("Network error"));
    request.send(file);
  });
}

export function fileExtension(file) {
  return (file.name.split(".").pop() || "").toLowerCase();
}
