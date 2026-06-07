const LOCAL_API_ORIGIN = 'http://127.0.0.1:18766';

function isLocalHost(hostname: string) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
}

export function apiOrigin() {
  if (typeof window === 'undefined') return '';
  const { protocol, hostname, port, origin } = window.location;

  if (protocol !== 'http:' && protocol !== 'https:') return LOCAL_API_ORIGIN;
  if (isLocalHost(hostname) && port !== '18766') return LOCAL_API_ORIGIN;
  if (isLocalHost(hostname) && port === '18766') return '';
  return origin;
}

export function apiUrl(path: string) {
  if (/^https?:\/\//i.test(path) || path.startsWith('data:') || path.startsWith('blob:')) {
    return path;
  }
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const origin = apiOrigin();
  return origin ? `${origin}${normalized}` : normalized;
}
