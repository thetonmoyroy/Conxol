/** Expand complete MAC addresses while keeping ordinary searches literal. */
export function terminalSearchTerm(query: string, caseSensitive: boolean) {
  const term = query.trim();
  const mac = /^(?:[0-9a-f]{2}([.:-])(?:[0-9a-f]{2}\1){4}[0-9a-f]{2}|[0-9a-f]{4}([.:-])[0-9a-f]{4}\2[0-9a-f]{4})$/i;
  if (!mac.test(term)) return { term, regex: false, caseSensitive };

  const digits = term.replace(/[.:-]/g, "").toLowerCase();
  const variants = [2, 4].flatMap(size => {
    const groups = digits.match(new RegExp(`.{${size}}`, "g"))!;
    return ["\\.", ":", "-"].map(separator => groups.join(separator));
  });
  return { term: `\\b(?:${variants.join("|")})\\b`, regex: true, caseSensitive: false };
}
