// If the SheetJS CDN is unreachable, load the vendored copy
if (!window.XLSX) { var s = document.createElement('script'); s.src = 'vendor/xlsx.full.min.js'; document.head.appendChild(s); }
