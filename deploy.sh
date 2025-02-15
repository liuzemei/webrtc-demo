#!/bin/bash

# 显示执行的命令
set -x

# 错误时退出
set -e

echo "开始构建项目..."
npm run build

if [ $? -eq 0 ]; then
    echo "构建成功，开始同步到远程服务器..."
    rsync -avz --delete ./dist/ liu:/home/neo/github/liuzemei/webrtc-demo/dist/
    
    if [ $? -eq 0 ]; then
        echo "✨ 部署完成！"
    else
        echo "❌ 同步失败"
        exit 1
    fi
else
    echo "❌ 构建失败"
    exit 1
fi