#!/bin/bash

# Antigravity 数据存储位置确认脚本

echo "======================================"
echo "Antigravity 数据存储位置检查"
echo "======================================"
echo ""

# 1. 检查 ~/.gemini/ 目录
echo "1. 检查 ~/.gemini/ 目录:"
if [ -d ~/.gemini ]; then
    echo "✅ ~/.gemini/ 存在"
    echo ""
    echo "目录结构:"
    tree -L 2 ~/.gemini 2>/dev/null || ls -la ~/.gemini
    echo ""

    # 检查关键文件
    echo "关键文件检查:"
    [ -f ~/.gemini/GEMINI.md ] && echo "  ✅ GEMINI.md 存在" || echo "  ❌ GEMINI.md 不存在"
    [ -f ~/.gemini/oauth_creds.json ] && echo "  ✅ oauth_creds.json 存在" || echo "  ❌ oauth_creds.json 不存在"
    [ -d ~/.gemini/antigravity ] && echo "  ✅ antigravity/ 目录存在" || echo "  ❌ antigravity/ 目录不存在"
    echo ""
else
    echo "❌ ~/.gemini/ 不存在"
    echo ""
fi

# 2. 检查 ~/.local/share/antigravity/
echo "2. 检查 ~/.local/share/antigravity/ 目录:"
if [ -d ~/.local/share/antigravity ]; then
    echo "✅ ~/.local/share/antigravity/ 存在"
    echo ""
    echo "目录结构:"
    tree -L 3 ~/.local/share/antigravity 2>/dev/null || ls -laR ~/.local/share/antigravity | head -50
    echo ""
else
    echo "❌ ~/.local/share/antigravity/ 不存在"
    echo ""
fi

# 3. 检查 ~/.cache/antigravity/
echo "3. 检查 ~/.cache/antigravity/ 目录:"
if [ -d ~/.cache/antigravity ]; then
    echo "✅ ~/.cache/antigravity/ 存在"
    echo ""
    echo "目录结构:"
    tree -L 2 ~/.cache/antigravity 2>/dev/null || ls -la ~/.cache/antigravity
    echo ""
else
    echo "❌ ~/.cache/antigravity/ 不存在"
    echo ""
fi

# 4. 检查 ~/.config/antigravity/
echo "4. 检查 ~/.config/antigravity/ 目录:"
if [ -d ~/.config/antigravity ]; then
    echo "✅ ~/.config/antigravity/ 存在"
    echo ""
    echo "目录结构:"
    tree -L 2 ~/.config/antigravity 2>/dev/null || ls -la ~/.config/antigravity
    echo ""
else
    echo "❌ ~/.config/antigravity/ 不存在"
    echo ""
fi

# 5. 检查 ~/Library/Application Support/Antigravity (macOS)
echo "5. 检查 ~/Library/Application Support/Antigravity/ 目录:"
if [ -d ~/Library/Application\ Support/Antigravity ]; then
    echo "✅ ~/Library/Application Support/Antigravity/ 存在"
    echo ""
    echo "目录结构:"
    tree -L 3 ~/Library/Application\ Support/Antigravity 2>/dev/null || ls -laR ~/Library/Application\ Support/Antigravity | head -50
    echo ""
else
    echo "❌ ~/Library/Application Support/Antigravity/ 不存在"
    echo ""
fi

# 6. 搜索可能的会话文件
echo "6. 搜索会话相关文件 (*.json, *.jsonl, *.db):"
echo ""
echo "在 ~/.gemini/ 中:"
find ~/.gemini -type f \( -name "*.json" -o -name "*.jsonl" -o -name "*.db" \) 2>/dev/null | head -10
echo ""

echo "在 ~/.local/share/antigravity/ 中:"
find ~/.local/share/antigravity -type f \( -name "*.json" -o -name "*.jsonl" -o -name "*.db" \) 2>/dev/null | head -10
echo ""

echo "在 ~/Library/Application Support/Antigravity/ 中:"
find ~/Library/Application\ Support/Antigravity -type f \( -name "*.json" -o -name "*.jsonl" -o -name "*.db" \) 2>/dev/null | head -10
echo ""

# 7. 检查 OAuth 凭证文件内容（脱敏）
echo "7. OAuth 凭证文件检查:"
if [ -f ~/.gemini/oauth_creds.json ]; then
    echo "✅ 找到 oauth_creds.json，文件大小:"
    ls -lh ~/.gemini/oauth_creds.json
    echo ""
    echo "文件结构（脱敏）:"
    cat ~/.gemini/oauth_creds.json | jq 'with_entries(.value = if (.value | type) == "string" then (.value[:10] + "...") else .value end)' 2>/dev/null || echo "无法解析 JSON"
    echo ""
else
    echo "❌ oauth_creds.json 不存在"
    echo ""
fi

# 8. 检查最近修改的文件（可能是会话文件）
echo "8. 最近修改的文件 (最近 7 天):"
echo ""
find ~/.gemini ~/.local/share/antigravity ~/Library/Application\ Support/Antigravity ~/.cache/antigravity ~/.config/antigravity -type f -mtime -7 2>/dev/null | head -20
echo ""

echo "======================================"
echo "检查完成！"
echo "======================================"
