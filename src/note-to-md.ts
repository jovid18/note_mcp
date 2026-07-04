/**
 * note HTML → markdown 변환기. md-to-note.ts 의 역방향.
 * note 본문은 제약된 HTML 서브셋(docs/note-api.md): 블록마다 name=id=UUID,
 * 지원 블록 h2/h3/p/blockquote/pre>code/hr/table/ul/ol/figure, 인라인 strong/em/s/code/a/br.
 * HTML 파서 의존성이 없으므로 이 서브셋에 맞춘 얇은 tolerant 파서를 직접 쓴다.
 */

interface ElementNode {
  type: "element";
  tag: string;
  attrs: Record<string, string>;
  children: Node[];
}
interface TextNode {
  type: "text";
  value: string;
}
type Node = ElementNode | TextNode;

export interface NoteToMdResult {
  markdown: string;
  warnings: string[];
}

const VOID = new Set(["br", "img", "hr", "wbr", "meta", "input"]);

/** HTML 엔티티 디코드 (본문에 흔한 것만) */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)")?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    attrs[m[1].toLowerCase()] = m[2] !== undefined ? decodeEntities(m[2]) : "";
  }
  return attrs;
}

/** HTML 문자열 → 노드 트리 (root children) */
function parseHtml(html: string): Node[] {
  const root: ElementNode = { type: "element", tag: "#root", attrs: {}, children: [] };
  const stack: ElementNode[] = [root];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s[^>]*?)?)\s*(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const top = () => stack[stack.length - 1];

  const pushText = (raw: string) => {
    if (!raw) return;
    const value = decodeEntities(raw);
    if (value) top().children.push({ type: "text", value });
  };

  while ((m = tagRe.exec(html))) {
    pushText(html.slice(last, m.index));
    last = tagRe.lastIndex;
    const [, closing, rawTag, rawAttrs, selfClose] = m;
    const tag = rawTag.toLowerCase();
    if (closing) {
      // 매칭되는 열림까지 pop (mismatch에 관대)
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
    } else {
      const node: ElementNode = { type: "element", tag, attrs: parseAttrs(rawAttrs), children: [] };
      top().children.push(node);
      if (!VOID.has(tag) && !selfClose) stack.push(node);
    }
  }
  pushText(html.slice(last));
  return root.children;
}

const isEl = (n: Node): n is ElementNode => n.type === "element";
const elements = (nodes: Node[]) => nodes.filter(isEl);
function findFirst(nodes: Node[], tag: string): ElementNode | undefined {
  for (const n of nodes) {
    if (isEl(n)) {
      if (n.tag === tag) return n;
      const inner = findFirst(n.children, tag);
      if (inner) return inner;
    }
  }
  return undefined;
}
function textContent(nodes: Node[]): string {
  return nodes
    .map((n) => (n.type === "text" ? n.value : textContent(n.children)))
    .join("");
}

class Converter {
  warnings: string[] = [];

  blocks(nodes: Node[]): string {
    const out: string[] = [];
    for (const n of nodes) {
      if (n.type === "text") {
        const t = n.value.trim();
        if (t) out.push(t); // 블록 밖 텍스트 (드묾)
        continue;
      }
      const md = this.block(n);
      if (md !== null) out.push(md);
    }
    return out.join("\n\n");
  }

  /** 블록 노드 → markdown (건너뛸 경우 null) */
  private block(node: ElementNode): string | null {
    switch (node.tag) {
      case "h1":
      case "h2":
        return `## ${this.inline(node.children).trim()}`;
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        return `### ${this.inline(node.children).trim()}`;
      case "p": {
        const md = this.inline(node.children).trim();
        return md === "" ? null : md; // <p><br></p> 같은 빈 문단은 스킵
      }
      case "blockquote": {
        const inner = this.blocks(node.children).trim();
        if (!inner) return null;
        return inner
          .split("\n")
          .map((l) => (l ? `> ${l}` : ">"))
          .join("\n");
      }
      case "pre": {
        const code = findFirst(node.children, "code");
        const raw = textContent(code ? code.children : node.children).replace(/\n$/, "");
        return "```\n" + raw + "\n```";
      }
      case "hr":
        return "---";
      case "ul":
        return this.list(node, false);
      case "ol":
        return this.list(node, true);
      case "table":
        return this.table(node);
      case "figure":
        return this.figure(node);
      case "div":
      case "section":
        // 래퍼는 내용만 펼침
        return this.blocks(node.children) || null;
      default:
        this.warnings.push(`지원하지 않는 블록(<${node.tag}>) 건너뜀.`);
        return null;
    }
  }

  private list(node: ElementNode, ordered: boolean): string {
    const items = elements(node.children).filter((c) => c.tag === "li");
    const lines: string[] = [];
    items.forEach((li, i) => {
      const marker = ordered ? `${i + 1}. ` : "- ";
      // li 안 중첩 리스트 분리
      const nested = elements(li.children).filter((c) => c.tag === "ul" || c.tag === "ol");
      const inlineChildren = li.children.filter((c) => !(isEl(c) && (c.tag === "ul" || c.tag === "ol")));
      const text = this.inline(inlineChildren).trim();
      lines.push(marker + text);
      for (const sub of nested) {
        const subMd = this.block(sub);
        if (subMd) lines.push(subMd.split("\n").map((l) => "  " + l).join("\n"));
      }
    });
    return lines.join("\n");
  }

  private table(node: ElementNode): string {
    const rows: ElementNode[] = [];
    const collect = (n: ElementNode) => {
      for (const c of elements(n.children)) {
        if (c.tag === "tr") rows.push(c);
        else if (c.tag === "thead" || c.tag === "tbody" || c.tag === "tfoot") collect(c);
      }
    };
    collect(node);
    if (rows.length === 0) return "";
    const cellsOf = (tr: ElementNode) =>
      elements(tr.children)
        .filter((c) => c.tag === "th" || c.tag === "td")
        .map((c) => this.inline(c.children).trim().replace(/\|/g, "\\|"));
    const header = cellsOf(rows[0]);
    const sep = header.map(() => "---");
    const bodyRows = rows.slice(1).map(cellsOf);
    const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
    return [line(header), line(sep), ...bodyRows.map(line)].join("\n");
  }

  private figure(node: ElementNode): string | null {
    const img = findFirst(node.children, "img");
    const figcap = findFirst(node.children, "figcaption");
    const caption = figcap ? this.inline(figcap.children).trim() : "";
    if (img) {
      const src = img.attrs.src || img.attrs["data-src"] || "";
      const alt = caption || img.attrs.alt || "";
      if (!src) {
        this.warnings.push("이미지 src 없는 figure 건너뜀.");
        return null;
      }
      return `![${alt}](${src})`;
    }
    // 임베드(iframe/외부 콘텐츠)는 링크로 보존 + 경고
    const dataSrc =
      node.attrs["data-src"] ||
      (findFirst(node.children, "iframe")?.attrs.src ?? "");
    if (dataSrc) {
      this.warnings.push(`임베드를 링크로 대체: ${dataSrc}`);
      return `[${caption || dataSrc}](${dataSrc})`;
    }
    this.warnings.push("내용 없는 figure 건너뜀.");
    return null;
  }

  /** 인라인 노드들 → markdown */
  private inline(nodes: Node[]): string {
    let out = "";
    for (const n of nodes) {
      if (n.type === "text") {
        out += n.value;
        continue;
      }
      switch (n.tag) {
        case "strong":
        case "b":
          out += `**${this.inline(n.children).trim()}**`;
          break;
        case "em":
        case "i":
          out += `*${this.inline(n.children).trim()}*`;
          break;
        case "s":
        case "del":
        case "strike":
          out += `~~${this.inline(n.children).trim()}~~`;
          break;
        case "code":
          out += `\`${textContent(n.children)}\``;
          break;
        case "br":
          out += "\n";
          break;
        case "a": {
          const href = n.attrs.href || "";
          const text = this.inline(n.children).trim() || href;
          out += href ? `[${text}](${href})` : text;
          break;
        }
        case "img": {
          const src = n.attrs.src || n.attrs["data-src"] || "";
          if (src) out += `![${n.attrs.alt || ""}](${src})`;
          break;
        }
        default:
          out += this.inline(n.children);
      }
    }
    return out;
  }
}

export function noteHtmlToMd(html: string): NoteToMdResult {
  const nodes = parseHtml(html || "");
  const c = new Converter();
  const markdown = c.blocks(nodes).replace(/\n{3,}/g, "\n\n").trim() + "\n";
  return { markdown, warnings: c.warnings };
}
