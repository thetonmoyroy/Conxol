export type GeneratorCommand = { id: string; text: string };
export type GeneratorLoop = { id: string; kind: "loop"; start: string; end: string; step: string; children: GeneratorBlock[] };
export type GeneratorBlock = GeneratorCommand | GeneratorLoop;
export const isLoop = (block: GeneratorBlock): block is GeneratorLoop => "kind" in block;
function range(start: string, end: string, step: string) {
  const values = [start, end, step];
  if (values.some(value => !/^-?\d+$/.test(value))) throw Error("Enter whole numbers in every loop.");
  const [first, last, increment] = values.map(Number);
  if (![first, last, increment].every(Number.isSafeInteger) || increment === 0 || (last - first) * increment < 0) throw Error("Count by must move toward the last number. Use a negative step to count down.");
  const count = Math.floor((last - first) / increment) + 1;
  if (count > 10000) throw Error("Use up to 10,000 repeats per loop.");
  return { first, increment, count };
}
export function generateConfig(commands: GeneratorBlock[], start: string, end: string, step: string) {
  try {
    let work = 0, size = 0;
    const lines: string[] = [];
    const outer = range(start, end, step);
    function validate(blocks: GeneratorBlock[], depth: number) {
      if (depth > 8) throw Error("Use up to 8 loop levels.");
      for (const block of blocks) if (isLoop(block)) { range(block.start, block.end, block.step); validate(block.children, depth + 1); }
    }
    validate(commands, 1);
    function expand(blocks: GeneratorBlock[], numbers: number[]) {
      if (++work > 100000) throw Error("Too many nested repeats. Use smaller ranges.");
      for (const block of blocks) {
        if (isLoop(block)) {
          const inner = range(block.start, block.end, block.step);
          for (let i = 0; i < inner.count; i++) expand(block.children, [...numbers, inner.first + i * inner.increment]);
        } else {
          if (++work > 100000) throw Error("Too many commands. Use smaller ranges.");
          const text = block.text.replace(/\{n(\d*)\}/g, (token, level: string) => {
            const index = level === "" ? 0 : Number(level) - 1;
            if (index < 0 || index >= numbers.length) throw Error(`Number ${token} is outside its loop. Move the command inside that loop.`);
            return String(numbers[index]);
          });
          size += text.length + 1;
          if (size > 2000000) throw Error("The result is too large. Use fewer commands or repeats.");
          lines.push(text);
        }
      }
    }
    for (let i = 0; i < outer.count; i++) expand(commands, [outer.first + i * outer.increment]);
    if (!lines.some(line => line.trim())) throw Error("Add a command to get started.");
    return { text: lines.join("\n"), error: "", count: outer.count };
  } catch (error) { return { text: "", error: error instanceof Error ? error.message : "Could not generate config.", count: 0 }; }
}
export function findBlock(blocks: GeneratorBlock[], id: string): GeneratorBlock | undefined {
  for (const block of blocks) {
    if (block.id === id) return block;
    if (isLoop(block)) { const found = findBlock(block.children, id); if (found) return found; }
  }
}
export function editBlocks(blocks: GeneratorBlock[], id: string, edit: (block: GeneratorBlock) => GeneratorBlock): GeneratorBlock[] {
  return blocks.map(block => block.id === id ? edit(block) : isLoop(block) ? { ...block, children: editBlocks(block.children, id, edit) } : block);
}
export function removeBlock(blocks: GeneratorBlock[], id: string): GeneratorBlock[] {
  return blocks.filter(block => block.id !== id).map(block => isLoop(block) ? { ...block, children: removeBlock(block.children, id) } : block);
}
export function moveBlock(blocks: GeneratorBlock[], id: string, parent: string, before?: string): GeneratorBlock[] {
  const block = findBlock(blocks, id);
  if (!block || id === before || id === parent || (isLoop(block) && findBlock(block.children, parent))) return blocks;
  const destination = findBlock(blocks, parent);
  if (parent !== "root" && (!destination || !isLoop(destination))) return blocks;
  const next = removeBlock(blocks, id);
  const insert = (items: GeneratorBlock[]) => { const result = [...items]; const index = before ? result.findIndex(item => item.id === before) : -1; result.splice(index < 0 ? result.length : index, 0, block); return result; };
  return parent === "root" ? insert(next) : editBlocks(next, parent, item => isLoop(item) ? { ...item, children: insert(item.children) } : item);
}
// Simple view groups neighboring commands without moving commands across loops.
export function simpleSections(blocks: GeneratorBlock[]): (GeneratorCommand[] | GeneratorLoop)[] {
  const sections: (GeneratorCommand[] | GeneratorLoop)[] = [];
  for (const block of blocks) {
    if (isLoop(block)) sections.push(block);
    else {
      const last = sections.at(-1);
      if (Array.isArray(last)) last.push(block);
      else sections.push([block]);
    }
  }
  return sections;
}
export function replaceSimpleSection(blocks: GeneratorBlock[], parent: string, ids: string[], text: string): GeneratorBlock[] {
  if (!ids.length) return blocks;
  const selected = new Set(ids);
  const replace = (items: GeneratorBlock[]) => items.flatMap(item => item.id === ids[0] ? [{ id: item.id, text }] : selected.has(item.id) ? [] : [item]);
  return parent === "root" ? replace(blocks) : editBlocks(blocks, parent, block => isLoop(block) ? { ...block, children: replace(block.children) } : block);
}
