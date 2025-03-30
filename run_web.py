#!/usr/bin/env python3
"""
OpenManus Web 服务器启动脚本
"""
import os
import sys
import argparse
import traceback
from pathlib import Path

# 将项目根目录添加到Python路径
project_root = Path(__file__).resolve().parent
sys.path.insert(0, str(project_root))

from app.logger import logger
from app.web import run_web_server
from app.web.manus_web import web_manus  # 确保初始化WebManus

def parse_args():
    """解析命令行参数"""
    parser = argparse.ArgumentParser(description="启动OpenManus Web服务器")
    parser.add_argument("--host", default="0.0.0.0", help="服务器主机地址")
    parser.add_argument("--port", type=int, default=5001, help="服务器端口")
    parser.add_argument("--debug", action="store_true", help="启用调试模式")
    return parser.parse_args()

def main():
    """主函数"""
    args = parse_args()

    logger.info(f"正在启动OpenManus Web服务器: http://{args.host}:{args.port}")
    logger.info("使用Ctrl+C停止服务器")

    # 确保工作区目录存在
    from app.config import WORKSPACE_ROOT
    if not WORKSPACE_ROOT.exists():
        logger.info(f"创建工作区目录: {WORKSPACE_ROOT}")
        WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)

    try:
        run_web_server(host=args.host, port=args.port, debug=args.debug)
    except KeyboardInterrupt:
        logger.info("服务器已停止")
    except Exception as e:
        logger.error(f"服务器启动失败: {e}")
        logger.error(traceback.format_exc())
        return 1

    return 0

if __name__ == "__main__":
    sys.exit(main())
