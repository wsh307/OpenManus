// 连接Socket.IO
const socket = io({
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    timeout: 20000
});

// 主DOM元素
const fileTree = document.getElementById('file-tree');
const editorContent = document.getElementById('editor-content');
const currentFilePath = document.getElementById('current-file-path');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendMessageBtn = document.getElementById('send-message');
const refreshFilesBtn = document.getElementById('refresh-files');
const newFileBtn = document.getElementById('new-file-btn');
const newFolderBtn = document.getElementById('new-folder-btn');
let toastContainer = null; // 提示框容器

// 当前活动文件元素
let activeFileElement = null;
// 存储当前打开的文件
let currentFile = null;
// 指示消息正在处理中
let messageProcessing = false;
// 文件自动刷新定时器
let autoRefreshTimer = null;
// 编辑模式
let editMode = false;
// 拖拽相关变量
let draggedItem = null;
let dragTarget = null;

// Toast通知系统
const toast = {
    // 保存所有活动的toast
    activeToasts: [],
    // 默认配置
    defaultOptions: {
        duration: 3000,
        type: 'info',
        dismissible: true
    },

    // 初始化toast容器
    init() {
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.className = 'toast-container';
            document.body.appendChild(toastContainer);
        }
    },

    // 显示提示
    show(message, options = {}) {
        this.init();

        // 合并默认选项和传入选项
        const settings = { ...this.defaultOptions, ...options };

        // 创建toast元素
        const toastElement = document.createElement('div');
        toastElement.className = `toast toast-${settings.type}`;

        // 设置图标
        let icon = 'info-circle';
        if (settings.type === 'success') icon = 'check-circle';
        else if (settings.type === 'warning') icon = 'exclamation-triangle';
        else if (settings.type === 'error') icon = 'times-circle';

        // 进度条元素
        const progressElement = document.createElement('div');
        progressElement.className = 'toast-progress';

        // 构建内容
        toastElement.innerHTML = `
            <div class="toast-content">
                <div class="toast-icon"><i class="fas fa-${icon}"></i></div>
                <div class="toast-message">${message}</div>
            </div>
            ${settings.dismissible ? '<div class="toast-close"><i class="fas fa-times"></i></div>' : ''}
        `;

        toastElement.appendChild(progressElement);

        // 添加到容器
        toastContainer.appendChild(toastElement);

        // 关闭按钮事件
        if (settings.dismissible) {
            const closeBtn = toastElement.querySelector('.toast-close');
            closeBtn.addEventListener('click', () => this.dismiss(toastElement));
        }

        // 记录这个toast
        const toastInfo = {
            element: toastElement,
            progress: progressElement,
            duration: settings.duration,
            timeoutId: null
        };

        this.activeToasts.push(toastInfo);

        // 显示toast并启动进度条
        requestAnimationFrame(() => {
            toastElement.classList.add('show');

            // 启动进度条
            progressElement.style.transition = `width ${settings.duration}ms linear`;

            // 延迟一帧以确保过渡效果生效
            requestAnimationFrame(() => {
                progressElement.style.width = '100%';
            });

            // 设置自动关闭
            toastInfo.timeoutId = setTimeout(() => {
                this.dismiss(toastElement);
            }, settings.duration);
        });

        return toastElement;
    },

    // 关闭提示
    dismiss(toastElement) {
        // 找到要关闭的toast
        const index = this.activeToasts.findIndex(t => t.element === toastElement);
        if (index !== -1) {
            const toastInfo = this.activeToasts[index];

            // 取消可能存在的超时
            if (toastInfo.timeoutId) {
                clearTimeout(toastInfo.timeoutId);
            }

            // 添加隐藏类以触发过渡效果
            toastElement.classList.add('hide');

            // 动画完成后移除元素
            setTimeout(() => {
                if (toastElement.parentNode) {
                    toastElement.parentNode.removeChild(toastElement);
                }
                // 从活动列表中移除
                this.activeToasts.splice(index, 1);
            }, 300); // 与CSS过渡时间相匹配
        }
    },

    // 清除所有提示
    clear() {
        this.activeToasts.forEach(toast => {
            if (toast.timeoutId) {
                clearTimeout(toast.timeoutId);
            }
            toast.element.classList.add('hide');
            setTimeout(() => {
                if (toast.element.parentNode) {
                    toast.element.parentNode.removeChild(toast.element);
                }
            }, 300);
        });
        this.activeToasts = [];
    },

    // 快捷方法
    success(message, options = {}) {
        return this.show(message, { ...options, type: 'success' });
    },

    info(message, options = {}) {
        return this.show(message, { ...options, type: 'info' });
    },

    warning(message, options = {}) {
        return this.show(message, { ...options, type: 'warning' });
    },

    error(message, options = {}) {
        return this.show(message, { ...options, type: 'error' });
    }
};

// 模态框管理
const modal = {
    // 当前模态框实例
    instance: null,
    // 键盘事件处理器
    keyDownHandler: null,

    // 创建模态框
    create(options) {
        // 如果已有模态框，先移除
        this.close();

        // 创建模态框容器
        const modalContainer = document.createElement('div');
        modalContainer.className = 'modal-container';

        // 创建模态框内容
        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';

        // 标题
        if (options.title) {
            const title = document.createElement('div');
            title.className = 'modal-title';
            title.textContent = options.title;
            modalContent.appendChild(title);
        }

        // 消息内容
        if (options.message) {
            const message = document.createElement('div');
            message.className = 'modal-message';
            message.textContent = options.message;
            modalContent.appendChild(message);
        }

        // 输入框（仅用于prompt类型）
        let inputElement = null;
        if (options.type === 'prompt') {
            inputElement = document.createElement('input');
            inputElement.type = 'text';
            inputElement.className = 'modal-input';
            if (options.defaultValue) {
                inputElement.value = options.defaultValue;
            }
            modalContent.appendChild(inputElement);
        }

        // 按钮容器
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'modal-buttons';

        // 取消按钮
        const cancelButton = document.createElement('button');
        cancelButton.className = 'modal-button modal-button-cancel';
        cancelButton.textContent = options.cancelText || '取消';
        cancelButton.addEventListener('click', () => {
            this.close();
            if (options.onCancel) {
                options.onCancel();
            }
        });

        // 确认按钮
        const confirmButton = document.createElement('button');
        confirmButton.className = 'modal-button modal-button-confirm';
        confirmButton.textContent = options.confirmText || '确定';
        confirmButton.addEventListener('click', () => {
            const result = inputElement ? inputElement.value : true;
            this.close();
            if (options.onConfirm) {
                options.onConfirm(result);
            }
        });

        // 添加按钮到容器
        // 确认框按钮顺序：[取消] [确认]，与中文习惯保持一致
        buttonContainer.appendChild(cancelButton);
        buttonContainer.appendChild(confirmButton);
        modalContent.appendChild(buttonContainer);

        // 组装模态框
        modalContainer.appendChild(modalContent);
        document.body.appendChild(modalContainer);

        // 如果有输入框，自动聚焦
        if (inputElement) {
            setTimeout(() => {
                inputElement.focus();
                inputElement.select();
            }, 50);
        }

        // 定义键盘事件处理函数（使用箭头函数保持对modal的引用）
        this.keyDownHandler = (e) => {
            if (e.key === 'Escape') {
                // Esc键关闭并取消
                this.close();
                if (options.onCancel) {
                    options.onCancel();
                }
            } else if (e.key === 'Enter' && !e.shiftKey) {
                // Enter键确认（如果不是在textarea中）
                if (!(e.target.tagName === 'TEXTAREA')) {
                    e.preventDefault();
                    const result = inputElement ? inputElement.value : true;
                    this.close();
                    if (options.onConfirm) {
                        options.onConfirm(result);
                    }
                }
            }
        };

        // 设置按键监听
        document.addEventListener('keydown', this.keyDownHandler);

        // 保存实例
        this.instance = {
            element: modalContainer,
            inputElement,
            options
        };

        // 添加显示动画类
        setTimeout(() => {
            modalContainer.classList.add('show');
        }, 10);

        return modalContainer;
    },

    // 关闭模态框
    close() {
        if (this.instance) {
            // 移除按键监听
            if (this.keyDownHandler) {
                document.removeEventListener('keydown', this.keyDownHandler);
                this.keyDownHandler = null;
            }

            // 添加关闭动画
            this.instance.element.classList.remove('show');

            // 延迟移除DOM元素
            setTimeout(() => {
                if (this.instance && this.instance.element && this.instance.element.parentNode) {
                    document.body.removeChild(this.instance.element);
                    this.instance = null;
                }
            }, 200);
        }
    },

    // 显示提示框
    alert(message, title) {
        return new Promise((resolve) => {
            this.create({
                type: 'alert',
                title: title || '提示',
                message,
                onConfirm: resolve,
                onCancel: resolve
            });
        });
    },

    // 显示确认框
    confirm(message, title) {
        return new Promise((resolve) => {
            this.create({
                type: 'confirm',
                title: title || '确认',
                message,
                onConfirm: () => resolve(true),
                onCancel: () => resolve(false)
            });
        });
    },

    // 显示输入框
    prompt(message, defaultValue, title) {
        return new Promise((resolve) => {
            this.create({
                type: 'prompt',
                title: title || '请输入',
                message,
                defaultValue,
                onConfirm: (value) => resolve(value),
                onCancel: () => resolve(null)
            });
        });
    }
};

// 初始化函数
function init() {
    // 初始化提示系统
    toast.init();

    // 加载文件树
    loadFileTree();

    // 设置Socket.IO事件监听
    setupSocketEvents();

    // 设置事件监听器
    setupEventListeners();

    // 请求消息历史
    socket.emit('get_message_history');

    // 启动自动刷新
    startAutoRefresh();

    // 创建上下文菜单
    createContextMenu();

    // 设置文档点击事件以关闭上下文菜单
    document.addEventListener('click', () => {
        hideContextMenu();
    });
}

// 启动自动刷新
function startAutoRefresh() {
    // 移除定时器刷新机制，改为事件驱动方式
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }

    // 首次加载文件树
    loadFileTree();
}

// 刷新当前文件
function refreshCurrentFile() {
    if (!currentFile || !currentFile.path) return;

    fetch(`/api/file?path=${encodeURIComponent(currentFile.path)}`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.error) {
                console.error(`Error refreshing file: ${data.error}`);
                return;
            }

            // 只有当内容发生变化时才更新显示
            if (currentFile.content !== data.content) {
                currentFile.content = data.content;
                displayFileContent(data.content, currentFile.path);
            }
        })
        .catch(error => {
            console.error(`Error refreshing file: ${error.message}`);
        });
}

// 加载文件树
function loadFileTree() {
    // 保存当前展开状态
    const expandedDirs = saveExpandedDirs();

    fetch('/api/workspace')
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                fileTree.innerHTML = `<div class="error">加载失败: ${data.error}</div>`;
                return;
            }

            if (!data.structure || data.structure.length === 0) {
                fileTree.innerHTML = '<div class="empty">工作区为空</div>';
                return;
            }

            // 只有在首次加载时显示加载中，刷新时保持原有内容
            if (fileTree.querySelector('.loading')) {
                fileTree.innerHTML = '<div class="loading">加载中...</div>';
            }

            fileTree.innerHTML = '';
            renderFileTree(data.structure, fileTree);

            // 恢复展开状态
            restoreExpandedDirs(expandedDirs);

            // 重新激活当前文件
            if (currentFile && currentFile.path) {
                highlightActiveFile(currentFile.path);
            }
        })
        .catch(error => {
            console.error(`Error loading file tree: ${error.message}`);
        });
}

// 保存当前展开的目录状态
function saveExpandedDirs() {
    const expandedDirs = [];
    document.querySelectorAll('.directory-children').forEach(el => {
        if (el.style.display === 'block') {
            // 找到父目录名称
            const dirName = el.previousElementSibling.textContent.trim();
            // 找到完整路径
            let parent = el.parentElement;
            let path = [dirName];

            while (parent && parent.classList.contains('directory')) {
                const parentDirName = parent.querySelector('.directory-name');
                if (parentDirName) {
                    path.unshift(parentDirName.textContent.trim());
                }
                parent = parent.parentElement.parentElement;
            }

            expandedDirs.push(path.join('/'));
        }
    });
    return expandedDirs;
}

// 恢复展开的目录状态
function restoreExpandedDirs(expandedDirs) {
    expandedDirs.forEach(path => {
        const parts = path.split('/');
        let currentLevel = document.querySelector('.file-tree');

        // 逐级查找目录
        for (let i = 0; i < parts.length; i++) {
            const dirName = parts[i];
            const dirElements = currentLevel.querySelectorAll('.directory-name');

            for (const dirEl of dirElements) {
                if (dirEl.textContent.trim() === dirName) {
                    // 展开此目录
                    const dirChildren = dirEl.nextElementSibling;
                    dirEl.querySelector('i').className = 'fas fa-folder-open';
                    dirChildren.style.display = 'block';

                    // 更新当前级别
                    currentLevel = dirChildren;
                    break;
                }
            }
        }
    });
}

// 高亮当前活动文件
function highlightActiveFile(path) {
    document.querySelectorAll('.file').forEach(el => {
        el.classList.remove('active');
        if (el.dataset.path === path) {
            el.classList.add('active');
            activeFileElement = el;
        }
    });
}

// 渲染文件树
function renderFileTree(items, container) {
    items.forEach(item => {
        if (item.type === 'directory') {
            // 创建目录元素
            const dirElement = document.createElement('div');
            dirElement.className = 'directory';
            dirElement.dataset.path = item.path;
            dirElement.dataset.type = 'directory';

            const dirName = document.createElement('div');
            dirName.className = 'directory-name';
            dirName.innerHTML = `<i class="fas fa-folder"></i> ${item.name}`;
            dirName.dataset.path = item.path;
            dirName.dataset.type = 'directory';
            dirName.dataset.name = item.name;

            const dirChildren = document.createElement('div');
            dirChildren.className = 'directory-children';
            dirChildren.style.display = 'none';

            // 添加点击事件以展开/折叠目录
            dirName.addEventListener('click', (e) => {
                // 阻止事件传播，防止影响拖拽
                e.stopPropagation();

                const icon = dirName.querySelector('i');

                if (dirChildren.style.display === 'none') {
                    dirChildren.style.display = 'block';
                    icon.className = 'fas fa-folder-open';
                } else {
                    dirChildren.style.display = 'none';
                    icon.className = 'fas fa-folder';
                }
            });

            // 添加右键菜单事件
            dirName.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showContextMenu(e, 'directory', item.path, item.name);
            });

            // 设置拖拽功能
            setupDragAndDrop(dirName, dirElement);

            // 添加子项目
            if (item.children && item.children.length > 0) {
                renderFileTree(item.children, dirChildren);
            } else {
                dirChildren.innerHTML = '<div class="empty">空目录</div>';
            }

            dirElement.appendChild(dirName);
            dirElement.appendChild(dirChildren);
            container.appendChild(dirElement);
        } else {
            // 创建文件元素
            const fileElement = document.createElement('div');
            fileElement.className = 'file';
            fileElement.dataset.path = item.path;
            fileElement.dataset.type = 'file';
            fileElement.dataset.name = item.name;

            // 根据文件类型设置图标
            let fileIcon = 'fa-file';
            const ext = item.name.split('.').pop().toLowerCase();

            if (['js', 'jsx', 'ts', 'tsx'].includes(ext)) {
                fileIcon = 'fa-file-code';
            } else if (['html', 'htm', 'xml'].includes(ext)) {
                fileIcon = 'fa-file-code';
            } else if (['css', 'scss', 'sass', 'less'].includes(ext)) {
                fileIcon = 'fa-file-code';
            } else if (['py', 'pyc'].includes(ext)) {
                fileIcon = 'fa-file-code';
            } else if (['md', 'txt'].includes(ext)) {
                fileIcon = 'fa-file-alt';
            } else if (['jpg', 'jpeg', 'png', 'gif', 'svg'].includes(ext)) {
                fileIcon = 'fa-file-image';
            } else if (['json', 'yaml', 'yml', 'toml'].includes(ext)) {
                fileIcon = 'fa-file-code';
            }

            fileElement.innerHTML = `<i class="fas ${fileIcon}"></i> ${item.name}`;

            // 添加点击事件以打开文件
            fileElement.addEventListener('click', (e) => {
                // 阻止事件传播，防止影响拖拽
                e.stopPropagation();
                openFile(item.path, fileElement);
            });

            // 添加右键菜单事件
            fileElement.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showContextMenu(e, 'file', item.path, item.name);
            });

            // 设置拖拽功能
            setupDragAndDrop(fileElement);

            container.appendChild(fileElement);
        }
    });
}

// 设置文件或目录的拖拽功能
function setupDragAndDrop(element) {
    // 使元素可拖拽
    element.setAttribute('draggable', 'true');

    // 拖拽开始
    element.addEventListener('dragstart', (e) => {
        draggedItem = element;
        e.dataTransfer.setData('text/plain', element.dataset.path);
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => {
            element.classList.add('dragging');
        }, 0);
    });

    // 拖拽结束
    element.addEventListener('dragend', () => {
        element.classList.remove('dragging');
        draggedItem = null;

        // 清除所有拖拽提示样式
        document.querySelectorAll('.drag-over').forEach(el => {
            el.classList.remove('drag-over');
        });
    });

    // 拖拽进入
    element.addEventListener('dragenter', (e) => {
        e.preventDefault();
        // 只有目录可以作为放置目标
        if (element.dataset.type === 'directory' && element !== draggedItem) {
            element.classList.add('drag-over');
            dragTarget = element;
        }
    });

    // 拖拽经过
    element.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (element.dataset.type === 'directory' && element !== draggedItem) {
            e.dataTransfer.dropEffect = 'move';
        } else {
            e.dataTransfer.dropEffect = 'none';
        }
    });

    // 拖拽离开
    element.addEventListener('dragleave', () => {
        element.classList.remove('drag-over');
        if (dragTarget === element) {
            dragTarget = null;
        }
    });

    // 放置
    element.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();

        element.classList.remove('drag-over');

        // 只有将文件或目录放置到其他目录才有效
        if (element.dataset.type === 'directory' && element !== draggedItem) {
            const sourcePath = draggedItem.dataset.path;
            const destPath = element.dataset.path;

            // 不能将目录移动到其子目录中
            if (draggedItem.dataset.type === 'directory' && destPath.startsWith(sourcePath + '/')) {
                addSystemMessage('错误：不能将目录移动到其子目录中');
                return;
            }

            moveFileOrDir(sourcePath, destPath);
        }
    });
}

// 创建上下文菜单
function createContextMenu() {
    // 如果已存在上下文菜单，则移除
    const existingMenu = document.getElementById('context-menu');
    if (existingMenu) {
        existingMenu.remove();
    }

    // 创建上下文菜单元素
    const contextMenu = document.createElement('div');
    contextMenu.id = 'context-menu';
    contextMenu.className = 'context-menu';
    contextMenu.style.display = 'none';

    // 将上下文菜单添加到文档
    document.body.appendChild(contextMenu);
}

// 显示上下文菜单
function showContextMenu(event, type, path, name) {
    const contextMenu = document.getElementById('context-menu');

    // 根据类型(file/directory)构建菜单项
    let menuHTML = '';

    const commonMenuItems = `
        <div class="menu-item" data-action="rename">
            <i class="fas fa-edit"></i> 重命名
        </div>
        <div class="menu-item" data-action="delete">
            <i class="fas fa-trash"></i> 删除
        </div>
    `;

    if (type === 'directory') {
        menuHTML = `
            <div class="menu-item" data-action="new-file">
                <i class="fas fa-file"></i> 新建文件
            </div>
            <div class="menu-item" data-action="new-directory">
                <i class="fas fa-folder"></i> 新建文件夹
            </div>
            <div class="menu-divider"></div>
            ${commonMenuItems}
        `;
    } else {
        menuHTML = commonMenuItems;
    }

    contextMenu.innerHTML = menuHTML;

    // 放置菜单在鼠标位置
    const x = event.clientX;
    const y = event.clientY;

    // 确保菜单不会超出窗口
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.style.display = 'block';

    // 调整菜单位置以防止超出右侧或底部
    const menuRect = contextMenu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth) {
        contextMenu.style.left = `${window.innerWidth - menuRect.width}px`;
    }
    if (menuRect.bottom > window.innerHeight) {
        contextMenu.style.top = `${window.innerHeight - menuRect.height}px`;
    }

    // 添加菜单项点击事件
    contextMenu.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', () => {
            const action = item.dataset.action;
            handleContextMenuAction(action, type, path, name);
            hideContextMenu();
        });
    });

    // 阻止事件传播
    event.stopPropagation();
}

// 隐藏上下文菜单
function hideContextMenu() {
    const contextMenu = document.getElementById('context-menu');
    if (contextMenu) {
        contextMenu.style.display = 'none';
    }
}

// 处理上下文菜单动作
function handleContextMenuAction(action, type, path, name) {
    switch (action) {
        case 'rename':
            promptRename(type, path, name);
            break;
        case 'delete':
            promptDelete(type, path, name);
            break;
        case 'new-file':
            promptNewFile(path);
            break;
        case 'new-directory':
            promptNewDirectory(path);
            break;
    }
}

// 修改重命名文件或目录的提示
async function promptRename(type, path, currentName) {
    const typeText = type === 'file' ? '文件' : '文件夹';
    const newName = await modal.prompt(`输入新的${typeText}名称:`, currentName, `重命名${typeText}`);

    if (newName && newName !== currentName) {
        renameFileOrDir(path, newName);
    }
}

// 新建文件的提示
async function promptNewFile(parentPath) {
    const fileName = await modal.prompt('输入新文件名称:', 'newfile.txt', '新建文件');

    if (fileName) {
        // 构建完整路径
        const filePath = parentPath ? `${parentPath}/${fileName}` : fileName;
        createNewFile(filePath);
    }
}

// 新建目录的提示
async function promptNewDirectory(parentPath) {
    const dirName = await modal.prompt('输入新文件夹名称:', 'newfolder', '新建文件夹');

    if (dirName) {
        // 构建完整路径
        const dirPath = parentPath ? `${parentPath}/${dirName}` : dirName;
        createNewDirectory(dirPath);
    }
}

// 删除文件或目录的提示
async function promptDelete(type, path, name) {
    const typeText = type === 'file' ? '文件' : '文件夹';
    const message = `确定要删除${typeText} "${name}" 吗?${type === 'directory' ? '\n注意：这将删除其中的所有内容！' : ''}`;

    const confirmed = await modal.confirm(message, `删除${typeText}`);
    if (confirmed) {
        deleteFileOrDir(path);
    }
}

// 重命名文件或目录
function renameFileOrDir(path, newName) {
    fetch('/api/file/rename', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            path: path,
            new_name: newName
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            toast.error(`重命名失败: ${data.error}`);
        } else {
            toast.success(`重命名成功`);

            // 如果重命名的是当前打开的文件，更新路径显示
            if (currentFile && currentFile.path === path) {
                currentFile.path = data.new_path;
                currentFilePath.textContent = data.new_path;
            }

            // 刷新文件树
            loadFileTree();
        }
    })
    .catch(error => {
        console.error('Error renaming:', error);
        toast.error(`重命名失败: ${error.message}`);
    });
}

// 创建新文件
function createNewFile(path) {
    fetch('/api/file/create', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            path: path,
            content: ''
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            toast.error(`创建文件失败: ${data.error}`);
        } else {
            toast.success(`文件创建成功`);

            // 刷新文件树
            loadFileTree();

            // 自动打开新创建的文件
            setTimeout(() => {
                const fileElement = document.querySelector(`.file[data-path="${path}"]`);
                if (fileElement) {
                    fileElement.click();
                }
            }, 500);
        }
    })
    .catch(error => {
        console.error('Error creating file:', error);
        toast.error(`创建文件失败: ${error.message}`);
    });
}

// 创建新目录
function createNewDirectory(path) {
    fetch('/api/directory/create', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            path: path
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            toast.error(`创建文件夹失败: ${data.error}`);
        } else {
            toast.success(`文件夹创建成功`);

            // 刷新文件树
            loadFileTree();

            // 自动展开新创建的目录
            setTimeout(() => {
                const dirElement = document.querySelector(`.directory-name[data-path="${path}"]`);
                if (dirElement) {
                    dirElement.click();
                }
            }, 500);
        }
    })
    .catch(error => {
        console.error('Error creating directory:', error);
        toast.error(`创建文件夹失败: ${error.message}`);
    });
}

// 删除文件或目录
function deleteFileOrDir(path) {
    fetch('/api/delete', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            path: path
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            toast.error(`删除失败: ${data.error}`);
        } else {
            toast.success(`删除成功`);

            // 如果删除的是当前打开的文件，清空编辑区
            if (currentFile && (currentFile.path === path || (currentFile.path && currentFile.path.startsWith(path + '/')))) {
                currentFile = null;
                currentFilePath.textContent = '未打开文件';
                editorContent.innerHTML = `
                    <div class="empty-editor">
                        <i class="fas fa-file-alt"></i>
                        <p>从左侧选择一个文件打开</p>
                    </div>
                `;
            }

            // 刷新文件树
            loadFileTree();
        }
    })
    .catch(error => {
        console.error('Error deleting:', error);
        toast.error(`删除失败: ${error.message}`);
    });
}

// 移动文件或目录
function moveFileOrDir(sourcePath, destPath) {
    fetch('/api/move', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            source: sourcePath,
            destination: destPath
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            toast.error(`移动失败: ${data.error}`);
        } else {
            toast.success(`移动成功`);

            // 如果移动的是当前打开的文件，更新路径显示
            if (currentFile && currentFile.path === sourcePath) {
                currentFile.path = data.destination;
                currentFilePath.textContent = data.destination;
            }

            // 刷新文件树
            loadFileTree();
        }
    })
    .catch(error => {
        console.error('Error moving:', error);
        toast.error(`移动失败: ${error.message}`);
    });
}

// 打开文件
function openFile(path, fileElement) {
    // 退出编辑模式
    exitEditMode();

    // 重置之前的活动文件样式
    if (activeFileElement) {
        activeFileElement.classList.remove('active');
    }

    // 设置新的活动文件
    activeFileElement = fileElement;
    activeFileElement.classList.add('active');

    // 更新文件路径显示
    currentFilePath.textContent = path;

    // 显示加载中
    editorContent.innerHTML = '<div class="loading">加载中...</div>';

    // 获取文件内容
    fetch(`/api/file?path=${encodeURIComponent(path)}`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.error) {
                editorContent.innerHTML = `<div class="error">加载失败: ${data.error}</div>`;
                return;
            }

            // 存储当前文件
            currentFile = data;

            // 显示文件内容
            displayFileContent(data.content, path);
        })
        .catch(error => {
            editorContent.innerHTML = `<div class="error">加载失败: ${error.message}</div>`;
        });
}

// 显示文件内容
function displayFileContent(content, path) {
    const ext = path.split('.').pop().toLowerCase();

    // 创建编辑器工具栏
    const toolbarHtml = createToolbar(ext);

    // 确定语言类型以进行代码高亮
    let language = '';
    if (['js', 'jsx'].includes(ext)) language = 'javascript';
    else if (['ts', 'tsx'].includes(ext)) language = 'typescript';
    else if (['py'].includes(ext)) language = 'python';
    else if (['html', 'htm'].includes(ext)) language = 'html';
    else if (['css'].includes(ext)) language = 'css';
    else if (['json'].includes(ext)) language = 'json';
    else if (['md'].includes(ext)) language = 'markdown';
    else if (['yaml', 'yml'].includes(ext)) language = 'yaml';

    // 清空编辑器内容
    editorContent.innerHTML = '';

    // 添加工具栏
    if (isEditableFile(ext)) {
        const toolbar = document.createElement('div');
        toolbar.className = 'editor-toolbar';
        toolbar.innerHTML = toolbarHtml;
        editorContent.appendChild(toolbar);

        // 添加工具栏事件监听
        setupToolbarEvents(toolbar, ext);
    }

    // 添加内容容器
    const contentContainer = document.createElement('div');
    contentContainer.className = 'editor-content-container';
    editorContent.appendChild(contentContainer);

    // 根据文件类型显示内容
    if (ext === 'md') {
        // Markdown 文件默认以预览方式显示
        displayMarkdownPreview(content, contentContainer);
    } else if (['html', 'htm'].includes(ext)) {
        // HTML 文件默认以预览方式显示
        displayHtmlPreview(content, contentContainer);
    } else if (language) {
        // 代码文件使用高亮显示
        contentContainer.innerHTML = `<pre><code class="language-${language}">${escapeHtml(content)}</code></pre>`;
        // 应用代码高亮
        contentContainer.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    } else {
        // 其他文件类型以纯文本显示
        contentContainer.innerHTML = `<pre>${escapeHtml(content)}</pre>`;
    }
}

// 创建工具栏
function createToolbar(fileExt) {
    if (!isEditableFile(fileExt)) return '';

    let buttons = '<button id="btn-edit" title="编辑"><i class="fas fa-edit"></i> 编辑</button>';

    if (fileExt === 'md') {
        buttons += '<button id="btn-preview" title="预览"><i class="fas fa-eye"></i> 预览</button>';
    } else if (['html', 'htm'].includes(fileExt)) {
        buttons += '<button id="btn-preview" title="预览"><i class="fas fa-eye"></i> 预览</button>';
    }

    buttons += '<button id="btn-save" title="保存" style="display:none"><i class="fas fa-save"></i> 保存</button>';
    buttons += '<button id="btn-cancel" title="取消" style="display:none"><i class="fas fa-times"></i> 取消</button>';

    return buttons;
}

// 设置工具栏事件监听
function setupToolbarEvents(toolbar, fileExt) {
    const btnEdit = toolbar.querySelector('#btn-edit');
    const btnPreview = toolbar.querySelector('#btn-preview');
    const btnSave = toolbar.querySelector('#btn-save');
    const btnCancel = toolbar.querySelector('#btn-cancel');

    if (btnEdit) {
        btnEdit.addEventListener('click', enterEditMode);
    }

    if (btnPreview) {
        btnPreview.addEventListener('click', () => {
            if (editMode) {
                // 如果在编辑模式，则从编辑器中获取内容进行预览
                const editorElement = document.querySelector('#file-editor');
                if (editorElement) {
                    const content = editorElement.value;
                    previewContent(content, fileExt);
                }
            } else {
                // 如果不在编辑模式，则直接预览当前文件
                if (currentFile && currentFile.content) {
                    previewContent(currentFile.content, fileExt);
                }
            }
        });
    }

    if (btnSave) {
        btnSave.addEventListener('click', saveFile);
    }

    if (btnCancel) {
        btnCancel.addEventListener('click', exitEditMode);
    }
}

// 检查文件是否可编辑
function isEditableFile(ext) {
    const editableExts = ['md', 'html', 'htm', 'txt', 'css', 'js', 'json', 'py', 'yaml', 'yml'];
    return editableExts.includes(ext);
}

// 进入编辑模式
function enterEditMode() {
    if (!currentFile || !currentFile.path) return;

    editMode = true;

    // 获取文件扩展名
    const ext = currentFile.path.split('.').pop().toLowerCase();

    // 更新工具栏按钮状态
    const toolbar = document.querySelector('.editor-toolbar');
    if (toolbar) {
        toolbar.querySelector('#btn-edit').style.display = 'none';
        if (toolbar.querySelector('#btn-preview')) {
            toolbar.querySelector('#btn-preview').style.display = 'inline-block';
        }
        toolbar.querySelector('#btn-save').style.display = 'inline-block';
        toolbar.querySelector('#btn-cancel').style.display = 'inline-block';
    }

    // 替换内容区域为文本编辑器
    const contentContainer = document.querySelector('.editor-content-container');
    if (contentContainer) {
        // 创建文本编辑器
        const textarea = document.createElement('textarea');
        textarea.id = 'file-editor';
        textarea.className = 'file-editor';
        textarea.value = currentFile.content || '';
        textarea.spellcheck = false;

        // 清空内容容器并添加编辑器
        contentContainer.innerHTML = '';
        contentContainer.appendChild(textarea);

        // 设置编辑器高度
        textarea.style.height = `${window.innerHeight * 0.6}px`;

        // 聚焦编辑器
        textarea.focus();
    }
}

// 退出编辑模式
function exitEditMode() {
    if (!editMode || !currentFile) return;

    editMode = false;

    // 如果当前有打开的文件，重新显示文件内容
    if (currentFile && currentFile.path) {
        displayFileContent(currentFile.content, currentFile.path);
    }
}

// 预览内容
function previewContent(content, fileExt) {
    const contentContainer = document.querySelector('.editor-content-container');
    if (!contentContainer) return;

    // 保存当前滚动位置
    const scrollPos = contentContainer.scrollTop;

    if (fileExt === 'md') {
        displayMarkdownPreview(content, contentContainer);
    } else if (['html', 'htm'].includes(fileExt)) {
        displayHtmlPreview(content, contentContainer);
    }

    // 恢复滚动位置
    contentContainer.scrollTop = scrollPos;
}

// 显示Markdown预览
function displayMarkdownPreview(content, container) {
    if (!content) {
        container.innerHTML = '<div class="empty-content">文件为空</div>';
        return;
    }

    try {
        // 使用内置的marked库来渲染Markdown
        // 如果没有CDN加载marked，可以直接显示格式化文本
        if (typeof marked !== 'undefined') {
            container.innerHTML = `<div class="markdown-preview">${marked.parse(content)}</div>`;
        } else {
            // 简单格式化：将#标题转为大字体，支持基本格式
            let formatted = content
                .replace(/^# (.+)$/gm, '<h1>$1</h1>')
                .replace(/^## (.+)$/gm, '<h2>$1</h2>')
                .replace(/^### (.+)$/gm, '<h3>$1</h3>')
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.+?)\*/g, '<em>$1</em>')
                .replace(/\n/g, '<br>');
            container.innerHTML = `<div class="markdown-preview">${formatted}</div>`;
        }
    } catch (e) {
        console.error("Error rendering markdown:", e);
        container.innerHTML = `<pre>${escapeHtml(content)}</pre>`;
    }
}

// 显示HTML预览
function displayHtmlPreview(content, container) {
    if (!content) {
        container.innerHTML = '<div class="empty-content">文件为空</div>';
        return;
    }

    try {
        // 创建一个安全的iframe来显示HTML
        container.innerHTML = `
            <div class="html-preview">
                <iframe sandbox="allow-same-origin" class="html-iframe"></iframe>
            </div>
        `;

        const iframe = container.querySelector('.html-iframe');
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

        // 写入HTML内容
        iframeDoc.open();
        iframeDoc.write(content);
        iframeDoc.close();

        // 设置iframe高度
        iframe.style.height = `${window.innerHeight * 0.6}px`;
    } catch (e) {
        console.error("Error rendering HTML:", e);
        container.innerHTML = `<pre>${escapeHtml(content)}</pre>`;
    }
}

// 保存文件
function saveFile() {
    if (!editMode || !currentFile || !currentFile.path) return;

    const editor = document.querySelector('#file-editor');
    if (!editor) return;

    const newContent = editor.value;

    // 显示保存状态
    const toolbar = document.querySelector('.editor-toolbar');
    if (toolbar) {
        const saveBtn = toolbar.querySelector('#btn-save');
        if (saveBtn) {
            const originalText = saveBtn.innerHTML;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 保存中...';
            saveBtn.disabled = true;

            // 发送到服务器
            saveFileContent(currentFile.path, newContent)
                .then(success => {
                    if (success) {
                        // 更新当前文件内容
                        currentFile.content = newContent;

                        // 退出编辑模式
                        exitEditMode();

                        // 添加保存成功通知
                        toast.success(`文件 ${currentFile.path} 已保存`);
                    } else {
                        // 保持编辑模式，显示错误
                        saveBtn.innerHTML = originalText;
                        saveBtn.disabled = false;
                        toast.error(`保存失败，请重试`);
                    }
                })
                .catch(error => {
                    console.error("Error saving file:", error);
                    saveBtn.innerHTML = originalText;
                    saveBtn.disabled = false;
                    toast.error(`保存失败：${error.message}`);
                });
        }
    }
}

// 发送文件内容到服务器
async function saveFileContent(path, content) {
    try {
        const response = await fetch('/api/file/save', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: path,
                content: content
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Server error: ${response.status}`);
        }

        return true;
    } catch (error) {
        console.error("Error saving file:", error);
        return false;
    }
}

// HTML转义函数
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// 设置Socket.IO事件监听
function setupSocketEvents() {
    // 连接事件
    socket.on('connect', () => {
        console.log('Connected to server');
        toast.success('已连接到服务器');
    });

    // 断开连接事件
    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        toast.warning('已断开连接，尝试重新连接...');
    });

    // 连接错误
    socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        toast.error('连接错误，请检查网络连接');
    });

    // 重连尝试
    socket.on('reconnect_attempt', (attemptNumber) => {
        console.log(`Attempting reconnect (${attemptNumber})`);
        toast.warning(`尝试重新连接 (${attemptNumber})`);
    });

    // 重连成功
    socket.on('reconnect', (attemptNumber) => {
        console.log(`Reconnected after ${attemptNumber} attempts`);
        toast.success(`重新连接成功，尝试次数: ${attemptNumber}`);
        // 重新加载文件树和消息历史
        loadFileTree();
        socket.emit('get_message_history');
    });

    // 当收到新消息时
    socket.on('new_message', (message) => {
        addMessageToChat(message);
        if (message.sender === 'assistant' && messageProcessing) {
            enableInput();
            messageProcessing = false;
        }
    });

    // 当收到思考消息时
    socket.on('thinking', (data) => {
        const thinkingDiv = document.createElement('div');
        thinkingDiv.className = 'thinking';
        thinkingDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Manus正在思考...';
        chatMessages.appendChild(thinkingDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });

    // 接收历史消息
    socket.on('message_history', (messages) => {
        // 清除现有的欢迎消息
        const welcomeMessage = document.querySelector('.welcome-message');
        if (welcomeMessage) {
            welcomeMessage.remove();
        }

        // 添加所有历史消息
        messages.forEach(message => {
            addMessageToChat(message);
        });
    });

    // 处理文件更新通知
    socket.on('file_update', (data) => {
        if (currentFile && currentFile.path === data.path) {
            currentFile.content = data.content;
            // 只有在非编辑模式下才更新显示
            if (!editMode) {
                displayFileContent(data.content, data.path);
            }
        }
    });

    // 处理工作区变更通知事件
    socket.on('workspace_change', (data) => {
        console.log('Workspace change:', data);

        // 根据不同的变更类型执行不同的操作
        switch(data.type) {
            case 'created':
                // 文件或目录创建，只刷新文件树
                loadFileTree();
                break;

            case 'deleted':
                // 文件或目录删除
                loadFileTree();

                // 如果当前打开的文件被删除，清空编辑器
                if (currentFile && (
                    currentFile.path === data.path ||
                    (data.is_directory && currentFile.path.startsWith(data.path + '/'))
                )) {
                    currentFile = null;
                    // 清空编辑器内容
                    const editorContent = document.querySelector('.editor-content');
                    if (editorContent) {
                        editorContent.innerHTML = `
                            <div class="empty-editor">
                                <i class="far fa-file-alt"></i>
                                <p>选择一个文件以查看或编辑</p>
                            </div>
                        `;
                    }

                    // 更新编辑器标题
                    const editorHeader = document.querySelector('.editor-header');
                    if (editorHeader) {
                        editorHeader.textContent = '无打开文件';
                    }
                }
                break;

            case 'modified':
                // 修改事件已通过file_update单独处理
                // 这里不需要额外操作
                break;

            case 'moved':
                // 文件或目录移动
                loadFileTree();

                // 如果当前打开的文件被移动，更新路径
                if (currentFile && currentFile.path === data.path) {
                    currentFile.path = data.dest_path;

                    // 更新编辑器标题
                    const editorHeader = document.querySelector('.editor-header');
                    if (editorHeader) {
                        const pathParts = data.dest_path.split('/');
                        editorHeader.textContent = pathParts[pathParts.length - 1];
                    }
                }
                break;
        }

        // 通知用户发生了变更
        const changeTypeMap = {
            'created': '创建',
            'deleted': '删除',
            'modified': '修改',
            'moved': '移动'
        };

        const typeText = data.is_directory ? '目录' : '文件';
        const changeText = changeTypeMap[data.type] || '变更';

        // 使用Toast通知文件变更
        const messageType = data.type === 'deleted' ? 'warning' : 'info';
        toast[messageType](`${typeText} ${data.path} 已${changeText}`);
    });

    // 处理代理思考过程
    socket.on('agent_thoughts', (data) => {
        // 将内容转换为Markdown格式
        const markdownContent = formatLogToMarkdown(data.content, 'thoughts');

        const logMessage = {
            sender: 'system',
            content: `<div class="log-entry log-thoughts">
                        <div class="log-entry-header">
                            <i class="fas fa-lightbulb"></i>
                            <span class="log-title">Manus的思考</span>
                        </div>
                        <div class="log-entry-content markdown-content">
                            ${markdownContent}
                        </div>
                     </div>`,
            type: 'log',
            logType: 'thoughts'
        };
        addMessageToChat(logMessage);
    });

    // 处理工具参数
    socket.on('tool_args', (data) => {
        // 解析和格式化工具参数
        const formattedContent = formatToolArgsToMarkdown(data.content);

        const logMessage = {
            sender: 'system',
            content: `<div class="log-entry log-tool_args">
                        <div class="log-entry-header">
                            <i class="fas fa-wrench"></i>
                            <span class="log-title">工具参数</span>
                        </div>
                        <div class="log-entry-content markdown-content">
                            ${marked.parse(formattedContent)}
                        </div>
                     </div>`,
            type: 'log',
            logType: 'tool_args'
        };
        addMessageToChat(logMessage);
    });

    // 处理令牌使用情况
    socket.on('token_usage', (data) => {
        // 转为Markdown表格格式
        const markdownContent = formatTokenUsageToMarkdown(data.content);

        const logMessage = {
            sender: 'system',
            content: `<div class="log-entry log-token_usage">
                        <div class="log-entry-header">
                            <i class="fas fa-chart-bar"></i>
                            <span class="log-title">Token使用情况</span>
                        </div>
                        <div class="log-entry-content markdown-content">
                            ${marked.parse(markdownContent)}
                        </div>
                     </div>`,
            type: 'log',
            logType: 'token_usage'
        };
        addMessageToChat(logMessage);
    });

    // 处理激活工具事件
    socket.on('activating_tool', (data) => {
        // 使用Markdown格式
        const markdownContent = `**正在使用工具:** \`${data.tool_name}\``;

        const logMessage = {
            sender: 'system',
            content: `<div class="log-entry log-activating_tool">
                        <div class="log-entry-header">
                            <i class="fas fa-cogs"></i>
                            <span class="log-title">激活工具</span>
                        </div>
                        <div class="log-entry-content markdown-content">
                            ${marked.parse(markdownContent)}
                        </div>
                     </div>`,
            type: 'log',
            logType: 'activating_tool'
        };
        addMessageToChat(logMessage);
    });

    // 处理工具执行结果
    socket.on('tool_result', (data) => {
        // 使用Markdown格式
        const toolName = `\`${data.tool_name}\``;
        const markdownContent = `**工具执行完成:** ${toolName}\n\n${formatToolResultToMarkdown(data.result)}`;

        const logMessage = {
            sender: 'system',
            content: `<div class="log-entry log-tool_result">
                        <div class="log-entry-header">
                            <i class="fas fa-check-circle"></i>
                            <span class="log-title">工具执行结果</span>
                        </div>
                        <div class="log-entry-content markdown-content">
                            ${marked.parse(markdownContent)}
                        </div>
                     </div>`,
            type: 'log',
            logType: 'tool_result'
        };
        addMessageToChat(logMessage);
    });

    // 处理任务完成事件
    socket.on('task_complete', (data) => {
        const logMessage = {
            sender: 'system',
            content: `<div class="log-entry log-task-complete">
                        <div class="log-entry-header">
                            <i class="fas fa-check-double"></i>
                            <span class="log-title">任务状态</span>
                        </div>
                        <div class="log-entry-content markdown-content">
                            <div class="task-complete">
                                <i class="fas fa-check-circle"></i> ${data.message}
                            </div>
                        </div>
                     </div>`,
            type: 'log',
            logType: 'task_complete'
        };
        addMessageToChat(logMessage);

        // 启用输入框
        enableInput();
    });
}

// 格式化日志为Markdown
function formatLogToMarkdown(content, logType) {
    if (!content) return '';

    // 根据日志类型进行格式化
    switch (logType) {
        case 'thoughts':
            // 确保完整内容显示，不做截断处理
            content = content.trim();

            // 寻找标题格式的文本，并转为Markdown标题
            content = content.replace(/^(.*?):$/gm, '### $1');

            // 寻找列表项并转为Markdown列表
            content = content.replace(/^(\d+\.\s)/gm, '- ');

            // 强调重要内容
            content = content.replace(/(Next Steps|Steps to Implement|Proposed Enhancement|Summary|Overview|思考过程|分析|计划|实现步骤|Step \d+):([^:])/g, '**$1:**$2');

            // 如果有代码块，保留格式
            content = content.replace(/```([^`]+)```/g, function(match, code) {
                return '```\n' + code + '\n```';
            });

            // 添加额外处理，确保内容完整显示
            // 检查是否有被截断的内容（例如，以...结尾但没有相应的闭合标记）
            if (content.includes('...') && !content.includes('...\n')) {
                content = content.replace(/\.\.\./g, '');
            }

            // 确保所有段落都有适当的换行
            content = content.replace(/([^\n])\n([^\n])/g, '$1\n\n$2');

            // 处理代码片段 (例如: `const x = 1;`) 以防止被标题正则表达式识别
            content = content.replace(/`([^`]+)`/g, function(match) {
                return match.replace(/:/g, '&#58;');
            });

            return marked.parse(content);

        case 'token_usage':
            return formatTokenUsageToMarkdown(content);

        case 'tool_result':
            return formatToolResultToMarkdown(content);

        default:
            return marked.parse(content);
    }
}

// 更新思考日志CSS样式部分
document.addEventListener('DOMContentLoaded', function() {
    // 动态创建样式元素来控制思考内容的字体大小
    const styleElement = document.createElement('style');
    styleElement.textContent = `
        /* 确保思考内容完整显示的样式 */
        .log-type-thoughts .markdown-content {
            max-height: none !important;
            overflow: visible !important;
            font-size: 0.95em !important;
            line-height: 1.6 !important;
            white-space: normal !important;
            word-break: normal !important;
            overflow-wrap: break-word !important;
        }

        /* 优化长思考内容的显示 */
        .log-type-thoughts .markdown-content p {
            margin-bottom: 0.7em !important;
            white-space: normal !important;
            overflow-wrap: break-word !important;
        }
    `;
    document.head.appendChild(styleElement);
});

// 格式化Token使用情况为Markdown
function formatTokenUsageToMarkdown(content) {
    if (!content) return '';

    // 尝试从内容中提取Token使用数据
    const matches = content.match(/Input=(\d+), Completion=(\d+), .*? Total=(\d+)/);

    if (matches) {
        const [_, input, completion, total] = matches;
        return `| 类型 | 数量 |\n|------|------|\n| 输入 | ${input} |\n| 输出 | ${completion} |\n| 总计 | ${total} |`;
    }

    // 如果没有匹配到格式，返回原始内容
    return content;
}

// 格式化工具执行结果为Markdown
function formatToolResultToMarkdown(result) {
    if (!result) return '';

    // 如果结果包含文件内容输出，格式化为代码块
    if (result.includes('cat -n') || result.includes('file content')) {
        // 提取文件内容
        const codeMatch = result.match(/```([^`]+)```/);
        if (codeMatch) {
            return codeMatch[0];
        }

        // 如果没有匹配到代码块，但是有行号输出
        const fileContentMatch = result.match(/(\s+\d+\s+.+(\n|$))+/);
        if (fileContentMatch) {
            return '```\n' + fileContentMatch[0] + '\n```';
        }
    }

    // 检查是否是命令执行结果
    if (result.includes('Observed output') || result.includes('executed:')) {
        // 分离命令和输出
        const parts = result.split(/executed:|output of cmd/);
        if (parts.length > 1) {
            const output = parts[parts.length - 1].trim();
            return '```\n' + output + '\n```';
        }
    }

    // 默认情况，原样返回
    return result;
}

// 将系统消息添加到聊天 - 修改为使用Toast通知
function addSystemMessage(content, type = 'info') {
    // 根据内容选择合适的类型
    const messageType = type || determineMessageType(content);

    // 显示提示
    toast[messageType](content);
}

// 根据消息内容确定类型
function determineMessageType(content) {
    const lowerContent = content.toLowerCase();

    if (lowerContent.includes('成功') || lowerContent.includes('已保存') || lowerContent.includes('已连接')) {
        return 'success';
    }

    if (lowerContent.includes('错误') || lowerContent.includes('失败') || lowerContent.includes('异常')) {
        return 'error';
    }

    if (lowerContent.includes('警告') || lowerContent.includes('注意') || lowerContent.includes('尝试')) {
        return 'warning';
    }

    return 'info';
}

// 将消息添加到聊天
function addMessageToChat(message) {
    const messageElement = document.createElement('div');
    messageElement.className = `message ${message.sender}`;

    if (message.type === 'log') {
        messageElement.classList.add(`log-message`);
        if (message.logType) {
            messageElement.classList.add(`log-type-${message.logType}`);
        }
    }

    // 创建消息内容容器
    const contentElement = document.createElement('div');
    contentElement.className = 'message-content';

    // 处理不同类型的消息内容
    if (message.type === 'log') {
        contentElement.innerHTML = message.content;
    } else {
        contentElement.innerHTML = formatMessage(message.content);
    }

    messageElement.appendChild(contentElement);
    chatMessages.appendChild(messageElement);

    // 滚动到底部
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 格式化消息内容
function formatMessage(content) {
    if (!content) return '';

    // 转换换行符为 <br>
    content = content.replace(/\n/g, '<br>');

    // 转换代码块
    content = content.replace(/```([^`]*?)```/g, (match, code) => {
        return `<pre><code>${escapeHtml(code)}</code></pre>`;
    });

    // 转换行内代码
    content = content.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 高亮显示的代码块
    document.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightBlock(block);
    });

    return content;
}

// 禁用输入
function disableInput() {
    chatInput.disabled = true;
    sendMessageBtn.disabled = true;
    sendMessageBtn.style.opacity = '0.5';
}

// 启用输入
function enableInput() {
    chatInput.disabled = false;
    sendMessageBtn.disabled = false;
    sendMessageBtn.style.opacity = '1';
}

// 设置事件监听器
function setupEventListeners() {
    // 发送消息按钮点击
    sendMessageBtn.addEventListener('click', sendMessage);

    // 输入框按键事件(Enter发送, Shift+Enter换行)
    chatInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });

    // 刷新文件按钮点击
    refreshFilesBtn.addEventListener('click', loadFileTree);

    // 新建文件按钮点击
    newFileBtn.addEventListener('click', () => {
        promptNewFile('');
    });

    // 新建文件夹按钮点击
    newFolderBtn.addEventListener('click', () => {
        promptNewDirectory('');
    });

    // 添加文件树根目录的右键菜单
    fileTree.addEventListener('contextmenu', (e) => {
        // 仅当点击在空白区域时才显示
        if (e.target === fileTree) {
            e.preventDefault();
            showContextMenu(e, 'directory', '', '根目录');
        }
    });
}

// 发送消息
function sendMessage() {
    const message = chatInput.value.trim();

    if (!message || messageProcessing) {
        return;
    }

    // 设置消息处理标志
    messageProcessing = true;

    // 禁用输入，防止多次发送
    disableInput();

    // 发送到服务器
    socket.emit('send_message', { message });

    // 清空输入框
    chatInput.value = '';
}

// 格式化工具参数为更易读的Markdown
function formatToolArgsToMarkdown(content) {
    if (!content) return '';

    try {
        // 尝试解析JSON对象
        let jsonObj = null;
        try {
            jsonObj = JSON.parse(content);
        } catch (e) {
            // 如果解析单个JSON对象失败，尝试找出多个JSON对象
            const jsonRegex = /{[\s\S]*?}/g;
            const matches = content.match(jsonRegex);

            if (matches && matches.length > 0) {
                // 有多个JSON对象
                let result = '## 工具参数解析\n\n';

                for (let i = 0; i < matches.length; i++) {
                    try {
                        const obj = JSON.parse(matches[i]);
                        result += `### 命令 ${i+1}: \`${obj.command || '未知命令'}\`\n\n`;
                        result += formatJsonObjectToMarkdown(obj);

                        if (i < matches.length - 1) {
                            result += '\n\n---\n\n'; // 添加分隔线
                        }
                    } catch (parseErr) {
                        // 单个JSON解析失败，以代码块格式显示原始内容
                        result += '```\n' + matches[i] + '\n```\n\n';
                    }
                }

                return result;
            }
        }

        // 单个JSON对象的情况
        if (jsonObj) {
            let result = `## 工具参数解析: \`${jsonObj.command || '未知命令'}\`\n\n`;
            result += formatJsonObjectToMarkdown(jsonObj);
            return result;
        }

        // 不是JSON格式，返回代码块
        return '```\n' + content + '\n```';
    } catch (e) {
        // 出现异常，以代码块显示原始内容
        return '```\n' + content + '\n```';
    }
}

// 将JSON对象格式化为Markdown表格和高亮区域
function formatJsonObjectToMarkdown(obj) {
    if (!obj) return '';

    let result = '';

    // 列出所有参数的表格
    result += '| 参数 | 值 |\n|------|------|\n';

    // 处理特殊的命令字段
    Object.keys(obj).forEach(key => {
        const value = obj[key];

        // 对于不同类型的值有不同处理
        if (typeof value === 'string') {
            if (key === 'command') {
                result += `| \`${key}\` | **${value}** |\n`;
            } else if (key === 'path') {
                result += `| \`${key}\` | \`${value}\` |\n`;
            } else if (value.length > 50) {
                // 长字符串，在表格中显示缩略信息
                result += `| \`${key}\` | *长文本 (${value.length} 字符)* |\n`;
            } else {
                result += `| \`${key}\` | ${value} |\n`;
            }
        } else if (typeof value === 'number') {
            result += `| \`${key}\` | ${value} |\n`;
        } else if (typeof value === 'boolean') {
            result += `| \`${key}\` | ${value ? '是' : '否'} |\n`;
        } else {
            // 对象或数组
            result += `| \`${key}\` | *复杂数据* |\n`;
        }
    });

    // 对于特定类型的命令，提供更多详细信息
    if (obj.command) {
        result += '\n### 详细信息\n\n';

        switch (obj.command) {
            case 'str_replace':
                result += '**替换操作:**\n\n';
                result += `- 文件: \`${obj.path || '未指定'}\`\n`;
                result += `- 查找: \`${escapeMarkdown(obj.old_str || '未指定')}\`\n`;
                result += `- 替换为: \`${escapeMarkdown(obj.new_str || '未指定')}\`\n`;
                break;

            case 'insert':
                result += '**插入操作:**\n\n';
                result += `- 文件: \`${obj.path || '未指定'}\`\n`;
                result += `- 行号: ${obj.insert_line || '未指定'}\n\n`;

                if (obj.new_str) {
                    result += '**插入内容:**\n\n```html\n' + obj.new_str + '\n```\n';
                }
                break;

            case 'append':
                result += '**追加操作:**\n\n';
                result += `- 文件: \`${obj.path || '未指定'}\`\n\n`;

                if (obj.new_str) {
                    result += '**追加内容:**\n\n```\n' + obj.new_str + '\n```\n';
                }
                break;

            default:
                // 对于其他类型的命令，显示所有长文本参数
                Object.keys(obj).forEach(key => {
                    const value = obj[key];

                    if (typeof value === 'string' && value.length > 50) {
                        result += `\n**${key}:**\n\n`;

                        // 根据扩展名或内容特征确定代码块的语言
                        let language = '';
                        if (key === 'path' && value.match(/\.(html|htm)$/i)) {
                            language = 'html';
                        } else if (key === 'path' && value.match(/\.(js)$/i)) {
                            language = 'javascript';
                        } else if (key === 'path' && value.match(/\.(css)$/i)) {
                            language = 'css';
                        } else if (key === 'path' && value.match(/\.(py)$/i)) {
                            language = 'python';
                        } else if (value.match(/<\/?[a-z][\s\S]*>/i)) {
                            language = 'html';
                        }

                        result += '```' + language + '\n' + value + '\n```\n';
                    }
                });
                break;
        }
    }

    return result;
}

// 转义Markdown特殊字符的工具函数
function escapeMarkdown(text) {
    if (!text) return '';
    return text
        .replace(/\*/g, '\\*')
        .replace(/_/g, '\\_')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)')
        .replace(/\#/g, '\\#')
        .replace(/\+/g, '\\+')
        .replace(/\-/g, '\\-')
        .replace(/\`/g, '\\`');
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);
