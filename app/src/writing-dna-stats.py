"""Deterministic corpus word/POS counts. No model calls or source normalization."""
import collections
import json
import sys
import jieba
import jieba.posseg

jieba.setLogLevel(40)
sys.stdin.reconfigure(encoding="utf-8")
data = json.load(sys.stdin)
counts = {"nouns": collections.Counter(), "verbs": collections.Counter(), "adverbs": collections.Counter()}
unclassified = collections.Counter()
for article in data:
    for token in jieba.posseg.cut(article["content"]):
        word, tag = token.word.strip(), token.flag
        if not word or not any(c.isalnum() for c in word):
            continue
        kind = "nouns" if tag.startswith("n") else "verbs" if tag.startswith("v") else "adverbs" if tag == "d" else None
        if kind:
            counts[kind][word] += 1
        elif tag == "eng":
            unclassified[word] += 1
result = {key: value.most_common(50 if key == "verbs" else 100) for key, value in counts.items()}
result.update({"tool": "jieba.posseg/0.42.1", "englishUnclassified": unclassified.most_common(100), "limitation": "词性由词典标注；英文词性未分类，不用中文标签冒充英文词性。"})
sys.stdout.write(json.dumps(result, ensure_ascii=True))
