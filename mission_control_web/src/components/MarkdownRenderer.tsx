import { type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("json", json);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);

function textFromChildren(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textFromChildren).join("");
  return "";
}

function CodeBlock({ className, children }: { className?: string; children?: ReactNode }) {
  const code = textFromChildren(children).replace(/\n$/, "");
  const language = /language-(\w+)/.exec(className ?? "")?.[1] ?? "";
  const highlighted = language && hljs.getLanguage(language)
    ? hljs.highlight(code, { language }).value
    : hljs.highlightAuto(code).value;

  const copy = () => void navigator.clipboard.writeText(code);

  return (
    <div className="group/code relative my-2 rounded-2xl border border-foreground/10 bg-background px-3 py-2.5">
      <button
        type="button"
        onClick={copy}
        className="absolute right-2 top-2 rounded-full border border-foreground/10 bg-background px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-foreground/45 opacity-0 transition-opacity hover:text-foreground group-hover/code:opacity-100"
      >
        Copy
      </button>
      <pre className="overflow-x-auto pr-12 font-mono text-[11px] leading-5 text-foreground/82"><code dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>
    </div>
  );
}

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="mc-markdown text-sm leading-6 text-foreground/88">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--warm-glow)] no-underline hover:underline">{children}</a>,
          p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
          h1: ({ children }) => <h1 className="mb-1 mt-2 font-expanded text-base uppercase tracking-[0.08em] text-foreground">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-1 mt-2 font-expanded text-sm uppercase tracking-[0.08em] text-foreground">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1 mt-2 text-xs font-semibold uppercase tracking-[0.1em] text-foreground">{children}</h3>,
          ul: ({ children }) => <ul className="my-1.5 ml-4 list-disc space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="my-1.5 ml-4 list-decimal space-y-0.5">{children}</ol>,
          blockquote: ({ children }) => <blockquote className="my-2 border-l border-[color-mix(in_srgb,var(--warm-glow)_35%,transparent)] pl-3 text-foreground/64">{children}</blockquote>,
          table: ({ children }) => <div className="my-2 overflow-x-auto"><table className="w-full text-left text-[11px]">{children}</table></div>,
          tr: ({ children }) => <tr className="border-b border-foreground/8 last:border-b-0">{children}</tr>,
          th: ({ children }) => <th className="px-2 py-1.5 font-semibold text-foreground">{children}</th>,
          td: ({ children }) => <td className="px-2 py-1.5 text-foreground/76">{children}</td>,
          code: ({ className, children }) => {
            if (className?.startsWith("language-")) return <CodeBlock className={className}>{children}</CodeBlock>;
            return <code className="rounded-md bg-[color-mix(in_srgb,var(--warm-glow)_10%,transparent)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--warm-glow)]">{children}</code>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
