export function browserDestination(input: string): string {
  const value = input.trim();
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return value;
  const host = value.split(/[/:?#]/, 1)[0];
  const parts = host.split(".");
  const ipv4 = parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
  if (ipv4 && !/\s/.test(value)) return `http://${value}`;
  if (/\s/.test(value) || (!value.includes(".") && !value.includes(":"))) {
    return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
  }
  return `https://${value}`;
}
