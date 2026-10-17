import { visit } from "unist-util-visit";
import { publicMediaUrl } from "../utils/media-utils.ts";

const mediaTags = new Set(["img", "source", "video", "audio"]);
const whitespace = /[\t\n\f\r ]/;

// Follow srcset's URL/descriptor boundaries without splitting commas in data URLs.
function mapSrcset(value, settings) {
  let result = "";
  let index = 0;
  while (index < value.length) {
    const separator = index;
    while (index < value.length && (whitespace.test(value[index]) || value[index] === ",")) index++;
    result += value.slice(separator, index);
    const start = index;
    while (index < value.length && !whitespace.test(value[index])) index++;
    let end = index;
    while (end > start && value[end - 1] === ",") end--;
    result += publicMediaUrl(value.slice(start, end), settings) + value.slice(end, index);
    if (end < index) continue;
    const descriptor = index;
    let parentheses = 0;
    while (index < value.length) {
      const char = value[index++];
      if (char === "(") parentheses++;
      else if (char === ")") parentheses = Math.max(0, parentheses - 1);
      else if (char === "," && !parentheses) break;
    }
    result += value.slice(descriptor, index);
  }
  return result;
}

function attributeValue(tag, attribute, value, settings) {
  if (tag === "a") return attribute === "href" ? publicMediaUrl(value, settings) : value;
  if (attribute === "srcset") return mapSrcset(value, settings);
  if (attribute === "src" || (tag === "video" && attribute === "poster")) return publicMediaUrl(value, settings);
  return value;
}

// Astro parses raw HTML after user rehype plugins, so handle its media attributes too.
function mapRawHtml(value, settings) {
  if (/^\s*<(?:script|style|pre|code)\b/i.test(value)) return value;
  return value.replace(/<(img|source|video|audio|a)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi, (openingTag, tagName) => {
    const tag = tagName.toLowerCase();
    return openingTag.replace(/(\s)([^\s"'<>/=]+)(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g,
      (attribute, space, name, equals, doubleQuoted, singleQuoted, unquoted) => {
        const original = doubleQuoted ?? singleQuoted ?? unquoted;
        const mapped = attributeValue(tag, name.toLowerCase(), original, settings);
        if (mapped === original) return attribute;
        const quote = doubleQuoted !== undefined ? '"' : singleQuoted !== undefined ? "'" : "";
        return `${space}${name}${equals}${quote}${mapped}${quote}`;
      });
  });
}

export default function rehypeMediaUrls(settings) {
  return (tree) => {
    visit(tree, (node) => {
      if (node.type === "raw" && typeof node.value === "string") {
        node.value = mapRawHtml(node.value, settings);
      } else if (node.type === "element" && (mediaTags.has(node.tagName) || node.tagName === "a")) {
        for (const [key, value] of Object.entries(node.properties || {})) {
          if (typeof value === "string") {
            node.properties[key] = attributeValue(node.tagName, key.toLowerCase(), value, settings);
          }
        }
      }
    });
  };
}
