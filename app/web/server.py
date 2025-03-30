import os
import json
import time
from pathlib import Path
from threading import Lock, Thread
from typing import Dict, List, Optional
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_socketio import SocketIO

from app.logger import logger
from app.config import config, PROJECT_ROOT, WORKSPACE_ROOT

# 创建Flask应用
app = Flask(__name__,
            template_folder=os.path.join(os.path.dirname(__file__), "templates"),
            static_folder=os.path.join(os.path.dirname(__file__), "static"))
app.config['SECRET_KEY'] = 'openmanus-secret-key'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# 线程锁，用于保护共享资源
thread_lock = Lock()
# 存储当前编辑的文件
current_file = {"path": None, "content": None}
# 存储消息历史
message_history = []

# 文件系统监控的观察者
fs_observer = None

class WorkspaceChangeHandler(FileSystemEventHandler):
    """工作区文件变更处理类"""

    def __init__(self):
        self.last_event_time = {}  # 用于防止重复事件
        self.debounce_interval = 0.5  # 去抖动时间间隔（秒）

    def _should_process_event(self, event_path):
        """判断是否应该处理事件（防止重复）"""
        current_time = time.time()
        last_time = self.last_event_time.get(event_path, 0)

        if current_time - last_time < self.debounce_interval:
            return False

        # 更新最后处理时间
        self.last_event_time[event_path] = current_time
        return True

    def _get_relative_path(self, path):
        """获取相对于工作区的路径"""
        try:
            abs_path = os.path.abspath(path)
            rel_path = os.path.relpath(abs_path, os.path.abspath(WORKSPACE_ROOT))
            return rel_path
        except:
            return path

    def on_created(self, event):
        """文件或目录创建事件"""
        if event.is_directory:
            logger.info(f"目录创建: {event.src_path}")
        else:
            logger.info(f"文件创建: {event.src_path}")

        if self._should_process_event(event.src_path):
            rel_path = self._get_relative_path(event.src_path)
            socketio.emit('workspace_change', {
                'type': 'created',
                'is_directory': event.is_directory,
                'path': rel_path
            })

    def on_deleted(self, event):
        """文件或目录删除事件"""
        if event.is_directory:
            logger.info(f"目录删除: {event.src_path}")
        else:
            logger.info(f"文件删除: {event.src_path}")

        if self._should_process_event(event.src_path):
            rel_path = self._get_relative_path(event.src_path)
            socketio.emit('workspace_change', {
                'type': 'deleted',
                'is_directory': event.is_directory,
                'path': rel_path
            })

    def on_modified(self, event):
        """文件或目录修改事件"""
        if not event.is_directory:
            # 只处理文件修改
            if self._should_process_event(event.src_path):
                rel_path = self._get_relative_path(event.src_path)

                # 如果是当前打开的文件，则更新内容
                if current_file["path"] == rel_path:
                    try:
                        with open(event.src_path, 'r', encoding='utf-8') as f:
                            updated_content = f.read()
                            current_file["content"] = updated_content

                            socketio.emit('file_update', {
                                'path': rel_path,
                                'content': updated_content
                            })
                    except Exception as e:
                        logger.error(f"读取更新文件失败: {e}")
                else:
                    # 不是当前文件，只通知有变化
                    socketio.emit('workspace_change', {
                        'type': 'modified',
                        'is_directory': False,
                        'path': rel_path
                    })

    def on_moved(self, event):
        """文件或目录移动事件"""
        if event.is_directory:
            logger.info(f"目录移动: {event.src_path} -> {event.dest_path}")
        else:
            logger.info(f"文件移动: {event.src_path} -> {event.dest_path}")

        if self._should_process_event(event.src_path):
            src_rel_path = self._get_relative_path(event.src_path)
            dest_rel_path = self._get_relative_path(event.dest_path)

            socketio.emit('workspace_change', {
                'type': 'moved',
                'is_directory': event.is_directory,
                'path': src_rel_path,
                'dest_path': dest_rel_path
            })

            # 如果是当前打开的文件被移动，更新路径
            if current_file["path"] == src_rel_path:
                current_file["path"] = dest_rel_path

def start_file_watcher():
    """启动文件系统监控"""
    global fs_observer

    if fs_observer is not None:
        # 如果已经在运行，先停止
        fs_observer.stop()
        fs_observer.join()

    event_handler = WorkspaceChangeHandler()
    fs_observer = Observer()

    # 监控WORKSPACE_ROOT目录及其子目录
    fs_observer.schedule(event_handler, str(WORKSPACE_ROOT), recursive=True)
    fs_observer.start()

    logger.info(f"文件系统监控已启动，监控目录: {WORKSPACE_ROOT}")

def stop_file_watcher():
    """停止文件系统监控"""
    global fs_observer

    if fs_observer is not None:
        fs_observer.stop()
        fs_observer.join()
        fs_observer = None
        logger.info("文件系统监控已停止")

@app.route('/')
def index():
    """渲染主页"""
    return render_template('index.html')

@app.route('/api/workspace')
def get_workspace():
    """获取工作目录结构"""
    def get_directory_structure(path):
        result = []
        for item in path.iterdir():
            if item.name.startswith('.'):
                continue

            if item.is_dir():
                result.append({
                    "name": item.name,
                    "type": "directory",
                    "path": str(item.relative_to(WORKSPACE_ROOT)),
                    "children": get_directory_structure(item)
                })
            else:
                result.append({
                    "name": item.name,
                    "type": "file",
                    "path": str(item.relative_to(WORKSPACE_ROOT)),
                    "size": item.stat().st_size
                })
        return sorted(result, key=lambda x: (x["type"] == "file", x["name"]))

    try:
        structure = get_directory_structure(WORKSPACE_ROOT)
        return jsonify({"structure": structure})
    except Exception as e:
        logger.error(f"Error getting workspace structure: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/file')
def get_file():
    """获取文件内容"""
    file_path = request.args.get('path')

    if not file_path:
        return jsonify({"error": "No file path provided"}), 400

    full_path = WORKSPACE_ROOT / file_path

    if not full_path.exists() or not full_path.is_file():
        return jsonify({"error": "File does not exist"}), 404

    try:
        with open(full_path, 'r', encoding='utf-8') as f:
            content = f.read()

        current_file["path"] = file_path
        current_file["content"] = content

        return jsonify({
            "path": file_path,
            "content": content
        })
    except Exception as e:
        logger.error(f"Error reading file {file_path}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/file/save', methods=['POST'])
def save_file():
    """保存文件内容"""
    data = request.json

    if not data or 'path' not in data or 'content' not in data:
        return jsonify({"error": "Missing path or content"}), 400

    file_path = data['path']
    content = data['content']

    full_path = WORKSPACE_ROOT / file_path

    # 检查目标目录是否存在
    parent_dir = full_path.parent
    if not parent_dir.exists():
        try:
            parent_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            logger.error(f"Error creating directory {parent_dir}: {e}")
            return jsonify({"error": f"Cannot create directory: {str(e)}"}), 500

    try:
        with open(full_path, 'w', encoding='utf-8') as f:
            f.write(content)

        # 更新当前文件内容
        if current_file["path"] == file_path:
            current_file["content"] = content

        logger.info(f"File {file_path} saved successfully")

        # 发送文件更新通知
        socketio.emit('file_update', {
            'path': file_path,
            'content': content
        })

        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"Error saving file {file_path}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/file/rename', methods=['POST'])
def rename_file_or_dir():
    """重命名文件或目录"""
    data = request.json

    if not data or 'path' not in data or 'new_name' not in data:
        return jsonify({"error": "缺少路径或新名称"}), 400

    file_path = data['path']
    new_name = data['new_name']

    # 验证新名称的合法性
    if not new_name or '/' in new_name or '\\' in new_name:
        return jsonify({"error": "新名称不合法"}), 400

    full_path = WORKSPACE_ROOT / file_path
    if not full_path.exists():
        return jsonify({"error": "源文件或目录不存在"}), 404

    # 创建新路径（仅改变名称，保留在相同目录）
    new_path = full_path.parent / new_name
    if new_path.exists():
        return jsonify({"error": "目标文件或目录已存在"}), 409

    try:
        full_path.rename(new_path)

        # 如果重命名的是当前打开的文件，更新当前文件路径
        if current_file["path"] == file_path:
            rel_new_path = str(new_path.relative_to(WORKSPACE_ROOT))
            current_file["path"] = rel_new_path

        logger.info(f"重命名 {file_path} 为 {new_name} 成功")

        return jsonify({
            "success": True,
            "old_path": file_path,
            "new_path": str(new_path.relative_to(WORKSPACE_ROOT))
        })
    except Exception as e:
        logger.error(f"重命名 {file_path} 失败: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/file/create', methods=['POST'])
def create_file():
    """创建新文件"""
    data = request.json

    if not data or 'path' not in data:
        return jsonify({"error": "缺少文件路径"}), 400

    file_path = data['path']
    content = data.get('content', '')

    full_path = WORKSPACE_ROOT / file_path
    if full_path.exists():
        return jsonify({"error": "文件已存在"}), 409

    # 确保父目录存在
    parent_dir = full_path.parent
    if not parent_dir.exists():
        try:
            parent_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            logger.error(f"创建目录 {parent_dir} 失败: {e}")
            return jsonify({"error": f"无法创建目录: {str(e)}"}), 500

    try:
        with open(full_path, 'w', encoding='utf-8') as f:
            f.write(content)

        logger.info(f"创建文件 {file_path} 成功")
        return jsonify({"success": True, "path": file_path})
    except Exception as e:
        logger.error(f"创建文件 {file_path} 失败: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/directory/create', methods=['POST'])
def create_directory():
    """创建新目录"""
    data = request.json

    if not data or 'path' not in data:
        return jsonify({"error": "缺少目录路径"}), 400

    dir_path = data['path']
    full_path = WORKSPACE_ROOT / dir_path

    if full_path.exists():
        return jsonify({"error": "目录已存在"}), 409

    try:
        full_path.mkdir(parents=True, exist_ok=True)
        logger.info(f"创建目录 {dir_path} 成功")
        return jsonify({"success": True, "path": dir_path})
    except Exception as e:
        logger.error(f"创建目录 {dir_path} 失败: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/delete', methods=['POST'])
def delete_file_or_dir():
    """删除文件或目录"""
    data = request.json

    if not data or 'path' not in data:
        return jsonify({"error": "缺少路径"}), 400

    path = data['path']
    full_path = WORKSPACE_ROOT / path

    if not full_path.exists():
        return jsonify({"error": "文件或目录不存在"}), 404

    try:
        if full_path.is_file():
            # 删除文件
            full_path.unlink()

            # 如果删除的是当前打开的文件，清除当前文件信息
            if current_file["path"] == path:
                current_file["path"] = None
                current_file["content"] = None

            logger.info(f"删除文件 {path} 成功")
        else:
            # 删除目录及其内容
            import shutil
            shutil.rmtree(full_path)

            # 如果当前打开的文件在被删除的目录中，清除当前文件信息
            if current_file["path"] and current_file["path"].startswith(path + '/'):
                current_file["path"] = None
                current_file["content"] = None

            logger.info(f"删除目录 {path} 成功")

        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"删除 {path} 失败: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/move', methods=['POST'])
def move_file_or_dir():
    """移动文件或目录"""
    data = request.json

    if not data or 'source' not in data or 'destination' not in data:
        return jsonify({"error": "缺少源路径或目标路径"}), 400

    source_path = data['source']
    dest_path = data['destination']

    source_full_path = WORKSPACE_ROOT / source_path
    dest_full_path = WORKSPACE_ROOT / dest_path

    if not source_full_path.exists():
        return jsonify({"error": "源文件或目录不存在"}), 404

    if dest_full_path.exists():
        # 如果目标是目录，则将源移动到该目录下
        if dest_full_path.is_dir():
            dest_full_path = dest_full_path / source_full_path.name
        else:
            return jsonify({"error": "目标文件已存在"}), 409

    # 确保目标父目录存在
    parent_dir = dest_full_path.parent
    if not parent_dir.exists():
        try:
            parent_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            logger.error(f"创建目录 {parent_dir} 失败: {e}")
            return jsonify({"error": f"无法创建目录: {str(e)}"}), 500

    try:
        source_full_path.rename(dest_full_path)

        # 如果移动的是当前打开的文件，更新当前文件路径
        if current_file["path"] == source_path:
            rel_dest_path = str(dest_full_path.relative_to(WORKSPACE_ROOT))
            current_file["path"] = rel_dest_path

        logger.info(f"移动 {source_path} 到 {dest_path} 成功")

        return jsonify({
            "success": True,
            "source": source_path,
            "destination": str(dest_full_path.relative_to(WORKSPACE_ROOT))
        })
    except Exception as e:
        logger.error(f"移动 {source_path} 失败: {e}")
        return jsonify({"error": str(e)}), 500

@socketio.on('connect')
def handle_connect():
    logger.info("Client connected")

@socketio.on('disconnect')
def handle_disconnect():
    logger.info("Client disconnected")

# 此处不再实现send_message，转移到manus_web.py处理
# 避免重复处理消息

@socketio.on('get_message_history')
def handle_get_history():
    """获取消息历史"""
    socketio.emit('message_history', message_history)

def run_web_server(host='0.0.0.0', port=5001, debug=False):
    """启动Web服务器"""
    logger.info(f"Starting web server on {host}:{port}")

    # 启动文件系统监控
    start_file_watcher()

    try:
        socketio.run(app, host=host, port=port, debug=debug, allow_unsafe_werkzeug=True)
    finally:
        # 确保在服务器关闭时停止文件监控
        stop_file_watcher()

if __name__ == '__main__':
    run_web_server(debug=True)
