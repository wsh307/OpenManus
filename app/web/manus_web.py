import asyncio
import threading
import re
from typing import Optional, Dict, Any, List
from concurrent.futures import ThreadPoolExecutor

from app.agent.manus import Manus
from app.logger import logger
from app.schema import Message
from app.web.server import socketio, current_file, message_history

# 日志消息模式，修改思考内容的正则表达式，使用非贪婪匹配并捕获整个思考内容
LOG_PATTERNS = {
    'thoughts': re.compile(r"✨ (.+?)'s thoughts: (.+)$", re.DOTALL),  # 使用DOTALL标志使.匹配包括换行符的任何字符
    'tool_args': re.compile(r"🔧 Tool arguments: (.+)"),
    'token_usage': re.compile(r"📊 Token usage: (.+)"),
    'activating_tool': re.compile(r"🔧 Activating tool: '(.+)'"),
    'tool_completed': re.compile(r"🎯 Tool '(.+)' completed its mission! Result: (.+)"),
}

class WebManus:
    """Web界面版本的Manus代理，集成了SocketIO实时通信"""

    def __init__(self):
        self.agent = Manus()
        self.lock = threading.Lock()
        self.running = False
        self.executor = ThreadPoolExecutor(max_workers=1)

        # 存储当前执行的会话信息
        self.current_session = {
            "thoughts": None,
            "tool_args": None,
            "token_usage": None,
            "current_tool": None
        }

        # 添加自定义日志处理
        logger.add(self._log_interceptor)

    def _log_interceptor(self, message):
        """处理日志消息并将匹配的内容发送到前端"""
        record = message.record
        msg = record["message"]

        # 匹配不同类型的日志消息
        for log_type, pattern in LOG_PATTERNS.items():
            match = pattern.search(msg)
            if match:
                if log_type == 'thoughts':
                    agent_name, thoughts = match.groups()
                    # 确保完整捕获思考内容
                    thoughts = thoughts.strip()
                    self._send_agent_thoughts(thoughts)
                elif log_type == 'tool_args':
                    args = match.group(1)
                    self._send_tool_args(args)
                elif log_type == 'token_usage':
                    usage = match.group(1)
                    self._send_token_usage(usage)
                elif log_type == 'activating_tool':
                    tool_name = match.group(1)
                    self._send_activating_tool(tool_name)
                elif log_type == 'tool_completed':
                    tool_name, result = match.groups()
                    self._send_tool_result(tool_name, result)
                break

    def _send_response(self, content: str, sender: str = "assistant"):
        """发送响应到前端"""
        message = {
            'sender': sender,
            'content': content
        }
        message_history.append(message)
        socketio.emit('new_message', message)

    def _send_agent_thoughts(self, thoughts: str):
        """发送代理思考过程到前端"""
        self.current_session["thoughts"] = thoughts
        socketio.emit('agent_thoughts', {
            'content': thoughts
        })

    def _send_tool_args(self, args: str):
        """发送工具参数到前端"""
        self.current_session["tool_args"] = args
        socketio.emit('tool_args', {
            'content': args
        })

    def _send_token_usage(self, usage: str):
        """发送Token使用情况到前端"""
        self.current_session["token_usage"] = usage
        socketio.emit('token_usage', {
            'content': usage
        })

    def _send_activating_tool(self, tool_name: str):
        """发送激活工具信息到前端"""
        self.current_session["current_tool"] = tool_name
        socketio.emit('activating_tool', {
            'tool_name': tool_name
        })

    def _send_tool_result(self, tool_name: str, result: str):
        """发送工具执行结果到前端"""
        socketio.emit('tool_result', {
            'tool_name': tool_name,
            'result': result
        })

    def _send_thinking(self, content: str):
        """发送思考过程到前端"""
        socketio.emit('thinking', {'content': content})

    def _send_file_update(self, file_path: str, content: str):
        """通知前端文件更新"""
        socketio.emit('file_update', {
            'path': file_path,
            'content': content
        })

    async def _process_message(self, user_message: str):
        """处理用户消息"""
        try:
            # 自定义观察类，用于拦截代理的消息
            original_update_memory = self.agent.update_memory

            def custom_update_memory(role, content, **kwargs):
                original_update_memory(role, content, **kwargs)

                if role == "assistant":
                    self._send_response(content)
                elif role == "tool":
                    self._send_thinking(content)

                # 检查是否有文件更新
                if current_file["path"] and "file" in content and current_file["path"] in content:
                    # 如果当前打开的文件被修改，通知前端
                    try:
                        with open(current_file["path"], 'r') as f:
                            updated_content = f.read()
                            current_file["content"] = updated_content
                            self._send_file_update(current_file["path"], updated_content)
                    except Exception as e:
                        logger.error(f"Error reading updated file: {e}")

            # 替换update_memory方法
            self.agent.update_memory = custom_update_memory

            # 清除当前会话信息
            self.current_session = {
                "thoughts": None,
                "tool_args": None,
                "token_usage": None,
                "current_tool": None
            }

            # 运行代理
            await self.agent.run(user_message)

            # 发送任务完成通知
            self._send_task_complete()

            # 恢复原始方法
            self.agent.update_memory = original_update_memory

        except Exception as e:
            logger.error(f"Error processing message: {e}")
            self._send_response(f"处理消息时出错: {str(e)}", "system")
        finally:
            with self.lock:
                self.running = False

    def _run_async_task(self, message: str):
        """在独立线程中运行异步任务"""
        try:
            # 创建新的事件循环
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

            # 运行任务并等待完成
            loop.run_until_complete(self._process_message(message))

            # 关闭循环
            loop.close()
        except Exception as e:
            logger.error(f"Error in async task: {str(e)}")
            self._send_response(f"任务执行出错: {str(e)}", "system")
            with self.lock:
                self.running = False

    def process_message(self, message: str):
        """处理用户消息的入口点"""
        with self.lock:
            if self.running:
                self._send_response("已有任务正在执行，请稍后再试", "system")
                return
            self.running = True

        # 使用线程池提交异步任务
        self.executor.submit(self._run_async_task, message)

    def _send_task_complete(self):
        """发送任务完成通知"""
        socketio.emit('task_complete', {
            'message': '任务已完成，请查看结果。'
        })

# 创建单例实例
web_manus = WebManus()

# 连接SocketIO事件
@socketio.on('send_message')
def handle_message(data):
    """处理用户发送的消息"""
    message = data.get('message', '')

    if not message.strip():
        socketio.emit('new_message', {
            'sender': 'system',
            'content': '请输入有效的消息'
        })
        return

    logger.info(f"Received message: {message}")

    # 保存用户消息到历史记录
    user_message = {
        'sender': 'user',
        'content': message
    }
    message_history.append(user_message)

    # 发送消息到所有客户端
    socketio.emit('new_message', user_message)

    # 使用WebManus处理消息
    web_manus.process_message(message)
