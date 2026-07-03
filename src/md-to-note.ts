/**
 * markdown(mdast) → note HTML 변환기.
 * note 본문 제약(docs/note-api.md): 블록 요소마다 name=id=UUID, h1 없음(→h2),
 * 지원 블록 h2/h3/p/blockquote/pre>code/hr/table/ul/ol/figure, 인라인 strong/em/code/a/br.
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { randomUUID } from "node:crypto";
import type { Root, RootContent, PhrasingContent } from "mdast";

export interface ImageInfo {
  url: string;
  alt: string;
  title: string | null;
}
/** 이미지 처리 콜백: <figure> HTML 문자열 반환, 처리 불가 시 null */
export type ImageHandler = (img: ImageInfo) => Promise<string | null>;

export interface ConvertResult {
  html: string;
  bodyLength: number;
  warnings: string[];
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => esc(s).replace(/"/g, "&quot;");
/** name=id=UUID 속성 (블록 요소용) */
const uid = () => {
  const u = randomUUID();
  return `name="${u}" id="${u}"`;
};

class Serializer {
  warnings: string[] = [];
  textLen = 0;
  constructor(private onImage?: ImageHandler) {}

  private addText(s: string) {
    this.textLen += s.length;
  }

  async blocks(nodes: RootContent[]): Promise<string> {
    const out: string[] = [];
    for (const n of nodes) out.push(await this.block(n));
    return out.filter(Boolean).join("");
  }

  private async block(node: RootContent): Promise<string> {
    switch (node.type) {
      case "heading": {
        const tag = node.depth <= 2 ? "h2" : "h3";
        return `<${tag} ${uid()}>${await this.inline(node.children)}</${tag}>`;
      }
      case "paragraph": {
        // 이미지 단독 문단 → figure 블록으로
        const inner = await this.inline(node.children);
        if (/^<figure[\s>]/.test(inner.trim()) && /<\/figure>$/.test(inner.trim())) {
          return inner;
        }
        return `<p ${uid()}>${inner}</p>`;
      }
      case "blockquote":
        return `<blockquote ${uid()}>${await this.blocks(node.children)}</blockquote>`;
      case "code": {
        this.addText(node.value);
        return `<pre ${uid()}><code>${esc(node.value)}</code></pre>`;
      }
      case "thematicBreak":
        return `<hr ${uid()}>`;
      case "list": {
        const tag = node.ordered ? "ol" : "ul";
        const items: string[] = [];
        for (const li of node.children) items.push(await this.listItem(li));
        return `<${tag} ${uid()}>${items.join("")}</${tag}>`;
      }
      case "table":
        return await this.table(node);
      case "html":
        this.warnings.push(`원시 HTML을 그대로 전달했습니다: ${node.value.slice(0, 40)}…`);
        return node.value;
      default: {
        // paragraph로 감쌀 수 있는 인라인이면 처리, 아니면 경고
        if ("children" in node && Array.isArray((node as any).children)) {
          return `<p ${uid()}>${await this.inline((node as any).children)}</p>`;
        }
        this.warnings.push(`지원하지 않는 블록(${node.type}) 건너뜀.`);
        return "";
      }
    }
  }

  private async listItem(li: any): Promise<string> {
    // li 안의 paragraph는 인라인으로 평탄화, 중첩 list는 그대로
    const parts: string[] = [];
    for (const child of li.children) {
      if (child.type === "paragraph") parts.push(await this.inline(child.children));
      else if (child.type === "list") parts.push(await this.block(child));
      else parts.push(await this.block(child));
    }
    return `<li>${parts.join("")}</li>`;
  }

  private async table(node: any): Promise<string> {
    const rows: string[] = [];
    node.children.forEach((row: any, ri: number) => {
      const cellTag = ri === 0 ? "th" : "td";
      const cells = row.children
        .map((cell: any) => `<${cellTag}>${this.inlineSync(cell.children)}</${cellTag}>`)
        .join("");
      rows.push(`<tr>${cells}</tr>`);
    });
    return `<table ${uid()}><tbody>${rows.join("")}</tbody></table>`;
  }

  /** 인라인 (이미지 업로드 위해 async) */
  private async inline(nodes: PhrasingContent[]): Promise<string> {
    const out: string[] = [];
    for (const n of nodes) out.push(await this.inlineNode(n));
    return out.join("");
  }

  private async inlineNode(node: PhrasingContent): Promise<string> {
    switch (node.type) {
      case "text":
        this.addText(node.value);
        return esc(node.value);
      case "strong":
        return `<strong>${await this.inline(node.children)}</strong>`;
      case "emphasis":
        return `<em>${await this.inline(node.children)}</em>`;
      case "delete":
        return `<s>${await this.inline(node.children)}</s>`;
      case "inlineCode":
        this.addText(node.value);
        return `<code>${esc(node.value)}</code>`;
      case "break":
        return "<br>";
      case "link": {
        this.addText(linkText(node.children));
        return `<a href="${escAttr(node.url)}">${await this.inline(node.children)}</a>`;
      }
      case "image": {
        const alt = node.alt ?? "";
        if (this.onImage) {
          const fig = await this.onImage({ url: node.url, alt, title: node.title ?? null });
          if (fig) return fig;
          this.warnings.push(`이미지 업로드 실패/건너뜀: ${node.url}`);
          return "";
        }
        this.warnings.push(`이미지 핸들러 없음, 건너뜀: ${node.url}`);
        return "";
      }
      case "html":
        return node.value;
      default:
        if ("children" in node && Array.isArray((node as any).children)) {
          return await this.inline((node as any).children);
        }
        if ("value" in node) {
          this.addText((node as any).value);
          return esc((node as any).value);
        }
        return "";
    }
  }

  /** 동기 인라인 (table 셀 등 이미지 불필요한 곳) */
  private inlineSync(nodes: PhrasingContent[]): string {
    return nodes
      .map((n) => {
        switch (n.type) {
          case "text":
            this.addText(n.value);
            return esc(n.value);
          case "strong":
            return `<strong>${this.inlineSync(n.children)}</strong>`;
          case "emphasis":
            return `<em>${this.inlineSync(n.children)}</em>`;
          case "delete":
            return `<s>${this.inlineSync(n.children)}</s>`;
          case "inlineCode":
            this.addText(n.value);
            return `<code>${esc(n.value)}</code>`;
          case "break":
            return "<br>";
          case "link":
            return `<a href="${escAttr(n.url)}">${this.inlineSync(n.children)}</a>`;
          default:
            return "children" in n ? this.inlineSync((n as any).children) : "";
        }
      })
      .join("");
  }
}

function linkText(nodes: PhrasingContent[]): string {
  return nodes.map((n) => ("value" in n ? (n as any).value : "")).join("");
}

export async function mdToNoteHtml(
  md: string,
  opts: { onImage?: ImageHandler } = {},
): Promise<ConvertResult> {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(md) as Root;
  const s = new Serializer(opts.onImage);
  const html = await s.blocks(tree.children);
  return { html, bodyLength: s.textLen, warnings: s.warnings };
}
