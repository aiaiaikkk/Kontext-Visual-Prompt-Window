/**
 * Visual Prompt Editor - 标注管理模块
 * 负责标注的创建、管理、选择和编辑功能
 */

import { createSVGElement, generateId, getCanvasCoordinates, TOOL_NAMES, COLOR_NAMES } from './visual_prompt_editor_utils.js';
import { initCanvasDrawing, setActiveTool } from './visual_prompt_editor_canvas.js';

/**
 * 获取下一个annotation编号
 */
function getNextAnnotationNumber(modal) {
    if (!modal.annotations) {
        modal.annotations = [];
    }
    
    // 找到当前最大的编号
    let maxNumber = -1;
    modal.annotations.forEach(annotation => {
        if (annotation.number !== undefined && annotation.number > maxNumber) {
            maxNumber = annotation.number;
        }
    });
    
    const nextNumber = maxNumber + 1;
    console.log('🔢 获取下一个annotation编号:', nextNumber, '(当前最大编号:', maxNumber, ')');
    return nextNumber;
}

/**
 * 绑定画布交互事件
 */
export function bindCanvasInteractionEvents(modal) {
    console.log('🎨 绑定画布交互事件开始');
    
    // 检查绘制层是否存在
    const drawingLayer = modal.querySelector('#drawing-layer');
    if (!drawingLayer) {
        console.warn('⚠️ 画布交互事件绑定时未找到绘制层');
        return;
    }
    
    // 获取必要的DOM元素
    const canvasContainer = modal.querySelector('#canvas-container');
    const zoomContainer = modal.querySelector('#zoom-container');
    const zoomLevel = modal.querySelector('#vpe-zoom-level');
    let currentZoom = modal.currentZoom || 1.0;
    let currentColor = '#f44336';
    let annotationHistory = [];
    
    if (!canvasContainer) {
        console.error('❌ 无法找到画布容器');
        return;
    }
    
    // 初始化工具和颜色状态
    modal.currentTool = 'rectangle';
    modal.currentColor = currentColor;
    
    // 设置初始状态 - 选中第一个工具和颜色
    const firstTool = modal.querySelector('.vpe-tool');
    const firstColor = modal.querySelector('.vpe-color');
    if (firstTool) firstTool.classList.add('active');
    if (firstColor) firstColor.classList.add('active');
    
    // 工具选择事件
    modal.querySelectorAll('.vpe-tool').forEach(tool => {
        tool.addEventListener('click', (e) => {
            // 清除其他工具的激活状态
            modal.querySelectorAll('.vpe-tool').forEach(t => t.classList.remove('active'));
            tool.classList.add('active');
            
            const toolName = tool.dataset.tool;
            modal.currentTool = toolName;
            setActiveTool(modal, toolName);
            
            console.log('🛠️ 工具切换:', toolName);
        });
    });
    
    // 颜色选择事件
    modal.querySelectorAll('.vpe-color').forEach(colorBtn => {
        colorBtn.addEventListener('click', (e) => {
            // 清除其他颜色的激活状态
            modal.querySelectorAll('.vpe-color').forEach(c => c.classList.remove('active'));
            colorBtn.classList.add('active');
            
            const color = colorBtn.dataset.color;
            modal.currentColor = color;
            currentColor = color;
            
            console.log('🎨 颜色切换:', color);
        });
    });
    
    // 初始化绘制状态
    let isDrawing = false;
    let startPoint = null;
    let currentPreview = null;
    let freehandPoints = [];
    let isDrawingFreehand = false;
    
    // 绘制鼠标按下事件
    canvasContainer.addEventListener('mousedown', function(e) {
        if (modal.isPanning) return; // 如果正在拖动，不处理绘制
        
        const tool = modal.currentTool || 'rectangle';
        const color = modal.currentColor || currentColor;
        
        // 阻止橡皮擦工具触发绘制事件
        if (tool === 'eraser') {
            console.log('🗑️ 橡皮擦工具不触发绘制事件');
            return;
        }
        
        // 自由绘制工具：左键添加锚点
        if (tool === 'freehand' && e.button === 0) {
            e.preventDefault();
            e.stopPropagation();
            
            console.log('🖱️ VPE自由绘制左键点击');
            
            const drawingLayer = modal.querySelector('#drawing-layer');
            const svg = drawingLayer ? drawingLayer.querySelector('svg') : null;
            
            if (!svg) return;
            
            const svgBBox = svg.getBoundingClientRect();
            
            // 计算鼠标相对于SVG元素的位置
            const svgRelativeX = e.clientX - svgBBox.left;
            const svgRelativeY = e.clientY - svgBBox.top;
            
            // 将相对位置映射到viewBox坐标系
            const svgX = (svgRelativeX / svgBBox.width) * svg.viewBox.baseVal.width;
            const svgY = (svgRelativeY / svgBBox.height) * svg.viewBox.baseVal.height;
            
            const newPoint = { x: svgX, y: svgY };
            
            // 检查是否在图像区域内
            const image = modal.querySelector('#vpe-main-image');
            if (image) {
                const imageRect = image.getBoundingClientRect();
                const relativeX = e.clientX - imageRect.left;
                const relativeY = e.clientY - imageRect.top;
                
                if (relativeX >= 0 && relativeX <= imageRect.width && 
                    relativeY >= 0 && relativeY <= imageRect.height) {
                    
                    // 如果是第一个点，开始绘制
                    if (!modal.isDrawingFreehand) {
                        startFreehandDrawing(modal, newPoint, color);
                    } else {
                        // 添加新的锚点
                        addFreehandPoint(modal, newPoint);
                    }
                }
            }
            return false;
        }
        
        // 其他工具：只处理左键
        if (e.button !== 0) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        console.log('🖱️ VPE画布左键按下，当前工具:', tool);
        
        // 如果是橡皮擦工具，不进行绘制，交给橡皮擦事件处理
        if (tool === 'eraser') {
            console.log('🗑️ 橡皮擦工具激活，不进行绘制');
            return;
        }
        
        const clickPoint = getCanvasCoordinates(e, canvasContainer);
        console.log('🖱️ VPE点击位置:', clickPoint);
        console.log('🖱️ Shift键状态:', e.shiftKey);
        
        const zoomContainer = modal.querySelector('#zoom-container');
        const drawingLayer = modal.querySelector('#drawing-layer');
        const svg = drawingLayer ? drawingLayer.querySelector('svg') : null;
        
        if (!svg || !zoomContainer) {
            console.error('❌ VPE缺少必要元素');
            return;
        }
        
        // 获取SVG的实际尺寸和变换
        const svgRect = svg.getBoundingClientRect();
        const containerRect = canvasContainer.getBoundingClientRect();
        
        // 获取当前的zoom值
        const actualZoom = modal.currentZoom || 1.0;
        console.log('🔍 VPE当前缩放比例:', actualZoom);
        
        // 添加详细的调试信息
        console.log('🔍 调试坐标转换:', {
            clickPoint,
            containerRect: { width: containerRect.width, height: containerRect.height },
            svgViewBox: { width: svg.viewBox.baseVal.width, height: svg.viewBox.baseVal.height },
            svgRect: { width: svgRect.width, height: svgRect.height }
        });
        
        // 获取图像元素和其位置
        const image = modal.querySelector('#vpe-main-image');
        if (image) {
            const imageRect = image.getBoundingClientRect();
            console.log('🖼️ 图像位置信息:', {
                imageRect: { 
                    left: imageRect.left, 
                    top: imageRect.top, 
                    width: imageRect.width, 
                    height: imageRect.height 
                },
                naturalSize: {
                    width: image.naturalWidth,
                    height: image.naturalHeight
                }
            });
            
            // 尝试新的坐标计算方法
            const drawingLayer = modal.querySelector('#drawing-layer');
            const layerRect = drawingLayer.getBoundingClientRect();
            console.log('🎨 绘图层位置:', {
                layerRect: {
                    left: layerRect.left,
                    top: layerRect.top, 
                    width: layerRect.width,
                    height: layerRect.height
                }
            });
        }
        
        // 计算相对于SVG的坐标
        // 关键修正：需要考虑SVG实际显示尺寸与viewBox的比例关系
        const svgElement = drawingLayer.querySelector('svg');
        const svgBBox = svgElement.getBoundingClientRect();
        
        // 计算鼠标相对于SVG元素的位置
        const svgRelativeX = e.clientX - svgBBox.left;
        const svgRelativeY = e.clientY - svgBBox.top;
        
        // 将相对位置映射到viewBox坐标系
        const svgX = (svgRelativeX / svgBBox.width) * svg.viewBox.baseVal.width;
        const svgY = (svgRelativeY / svgBBox.height) * svg.viewBox.baseVal.height;
        
        console.log('📐 坐标映射:', {
            mouse: { x: e.clientX, y: e.clientY },
            svgRelative: { x: svgRelativeX, y: svgRelativeY },
            svgBBox: { width: svgBBox.width, height: svgBBox.height },
            finalSVG: { x: svgX, y: svgY }
        });
        
        startPoint = { x: svgX, y: svgY, shiftKey: e.shiftKey };
        
        console.log('📍 VPE开始绘制位置:', startPoint);
        
        // 检查是否在图像区域内 - 修复缩放后的坐标判断
        if (image) {
            const imageRect = image.getBoundingClientRect();
            const containerRect = canvasContainer.getBoundingClientRect();
            
            // 计算相对于图像的点击坐标
            const relativeX = e.clientX - imageRect.left;
            const relativeY = e.clientY - imageRect.top;
            
            console.log('🔍 VPE坐标检查:', {
                imageRect: { width: imageRect.width, height: imageRect.height },
                relativeClick: { x: relativeX, y: relativeY },
                inBounds: relativeX >= 0 && relativeX <= imageRect.width && relativeY >= 0 && relativeY <= imageRect.height
            });
            
            if (relativeX >= 0 && relativeX <= imageRect.width && 
                relativeY >= 0 && relativeY <= imageRect.height) {
                console.log('✅ VPE点击在图像区域内');
                isDrawing = true;
                console.log('🎨 VPE开始绘制');
                
                startShapeDrawing(modal, startPoint, tool, color);
            } else {
                console.log('❌ VPE点击在图像区域外');
            }
        }
        
        return false;
    });
    
    // 绘制鼠标移动事件
    canvasContainer.addEventListener('mousemove', function(e) {
        // 如果正在拖动，交给拖动处理
        if (modal.isPanning) {
            return;
        }
        
        // 更新光标
        const cursors = {
            'select': 'default',
            'rectangle': 'crosshair',
            'circle': 'crosshair',
            'arrow': 'crosshair',
            'freehand': 'crosshair',
            'lasso': 'crosshair',
            'magic-wand': 'pointer',
            'eraser': 'pointer'
        };
        
        if (!modal.isPanning) {
            canvasContainer.style.cursor = cursors[modal.currentTool] || 'default';
        }
        
        const currentTool = modal.currentTool || 'rectangle';
        
        if (isDrawing && startPoint) {
            const drawingLayer = modal.querySelector('#drawing-layer');
            const svg = drawingLayer ? drawingLayer.querySelector('svg') : null;
            
            if (!svg) return;
            
            const svgBBox = svg.getBoundingClientRect();
            
            // 计算鼠标相对于SVG元素的位置
            const svgRelativeX = e.clientX - svgBBox.left;
            const svgRelativeY = e.clientY - svgBBox.top;
            
            // 将相对位置映射到viewBox坐标系
            const svgX = (svgRelativeX / svgBBox.width) * svg.viewBox.baseVal.width;
            const svgY = (svgRelativeY / svgBBox.height) * svg.viewBox.baseVal.height;
            
            const endPoint = { x: svgX, y: svgY, shiftKey: e.shiftKey || startPoint.shiftKey };
            
            if (currentTool !== 'freehand') {
                updatePreview(modal, startPoint, endPoint, currentTool, modal.currentColor);
            }
        }
    });
    
    // 绘制鼠标释放事件
    canvasContainer.addEventListener('mouseup', function(e) {
        if (e.button !== 0 || !isDrawing) return;
        
        const drawingLayer = modal.querySelector('#drawing-layer');
        const svg = drawingLayer ? drawingLayer.querySelector('svg') : null;
        
        if (!svg) return;
        
        const svgBBox = svg.getBoundingClientRect();
        
        // 计算鼠标相对于SVG元素的位置
        const svgRelativeX = e.clientX - svgBBox.left;
        const svgRelativeY = e.clientY - svgBBox.top;
        
        // 将相对位置映射到viewBox坐标系
        const svgX = (svgRelativeX / svgBBox.width) * svg.viewBox.baseVal.width;
        const svgY = (svgRelativeY / svgBBox.height) * svg.viewBox.baseVal.height;
        
        console.log('VPE画布坐标:', { svgX, svgY });
        
        const endPoint = { x: svgX, y: svgY, shiftKey: e.shiftKey || startPoint.shiftKey };
        
        console.log('📍 VPE结束绘制位置:', endPoint);
        console.log('✨ VPE尝试完成绘制');
        
        if (modal.currentTool !== 'freehand') {
            finishDrawing(modal, startPoint, endPoint, modal.currentTool, modal.currentColor);
        }
        
        isDrawing = false;
        startPoint = null;
        currentPreview = null;
    });
    
    // 右键事件 - 用于结束freehand绘制
    canvasContainer.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        
        const tool = modal.currentTool || 'rectangle';
        
        // 自由绘制工具：右键闭合曲线
        if (tool === 'freehand' && modal.isDrawingFreehand) {
            console.log('🖱️ VPE自由绘制右键闭合');
            finishFreehandDrawing(modal);
        }
        
        return false;
    });
}

/**
 * 开始形状绘制
 */
function startShapeDrawing(modal, startPoint, tool, color) {
    console.log('🎨 开始形状绘制:', { tool, color });
}

/**
 * 开始自由绘制
 */
function startFreehandDrawing(modal, startPoint, color) {
    console.log('🎨 开始自由绘制，起始点:', startPoint);
    const drawingLayer = modal.querySelector('#drawing-layer');
    const svg = drawingLayer ? drawingLayer.querySelector('svg') : null;
    
    if (!svg) return;
    
    // 初始化freehand状态
    modal.freehandPoints = [startPoint];
    modal.isDrawingFreehand = true;
    modal.currentColor = color;
    
    // 创建临时路径预览
    const path = createSVGElement('path', {
        'd': `M ${startPoint.x} ${startPoint.y}`,
        'stroke': color,
        'stroke-width': '3',
        'fill': 'none',
        'stroke-dasharray': '5,5',
        'class': 'freehand-preview'
    });
    
    svg.appendChild(path);
    modal.currentFreehandPath = path;
    
    // 添加第一个锚点标记
    addAnchorPoint(svg, startPoint, 0, color);
    
    console.log('✅ 自由绘制已开始，等待下一个锚点（左击）或闭合（右击）');
}

/**
 * 添加自由绘制锚点
 */
function addFreehandPoint(modal, newPoint) {
    if (!modal.isDrawingFreehand || !modal.freehandPoints) return;
    
    console.log('📍 添加自由绘制锚点:', newPoint);
    
    // 添加点到数组
    modal.freehandPoints.push(newPoint);
    
    const drawingLayer = modal.querySelector('#drawing-layer');
    const svg = drawingLayer ? drawingLayer.querySelector('svg') : null;
    
    if (!svg || !modal.currentFreehandPath) return;
    
    // 更新路径预览
    const pathData = modal.freehandPoints.map((point, index) => {
        return index === 0 ? `M ${point.x} ${point.y}` : `L ${point.x} ${point.y}`;
    }).join(' ');
    
    modal.currentFreehandPath.setAttribute('d', pathData);
    
    // 添加锚点标记
    const pointIndex = modal.freehandPoints.length - 1;
    addAnchorPoint(svg, newPoint, pointIndex, modal.currentColor);
    
    console.log(`✅ 锚点${pointIndex}已添加，当前共${modal.freehandPoints.length}个点`);
}

/**
 * 添加锚点标记
 */
function addAnchorPoint(svg, point, index, color) {
    const anchorPoint = createSVGElement('circle', {
        'cx': point.x,
        'cy': point.y,
        'r': '4',
        'fill': color,
        'stroke': '#fff',
        'stroke-width': '2',
        'class': 'anchor-point freehand-preview',
        'data-point-index': index
    });
    
    svg.appendChild(anchorPoint);
}

/**
 * 完成自由绘制
 */
function finishFreehandDrawing(modal) {
    if (!modal.isDrawingFreehand || !modal.freehandPoints || modal.freehandPoints.length < 3) {
        console.log('⚠️ 自由绘制至少需要3个点，当前:', modal.freehandPoints?.length || 0);
        return;
    }
    
    console.log('✨ 完成自由绘制，点数:', modal.freehandPoints.length);
    
    const drawingLayer = modal.querySelector('#drawing-layer');
    const svg = drawingLayer ? drawingLayer.querySelector('svg') : null;
    
    if (!svg) return;
    
    // 移除所有预览元素（路径和锚点）
    svg.querySelectorAll('.freehand-preview').forEach(el => el.remove());
    
    // 初始化annotations数组
    if (!modal.annotations) {
        modal.annotations = [];
    }
    
    // 获取标注编号（考虑已恢复的annotations）
    const annotationNumber = getNextAnnotationNumber(modal);
    const annotationId = generateId('annotation');
    
    // 创建最终的多边形
    const points = modal.freehandPoints.map(p => `${p.x},${p.y}`).join(' ');
    const polygon = createSVGElement('polygon', {
        'points': points,
        'fill': modal.currentColor,
        'fill-opacity': '0.5',
        'stroke': 'none',
        'class': 'annotation-shape',
        'data-annotation-id': annotationId
    });
    
    svg.appendChild(polygon);
    
    // 计算多边形的中心点用于放置编号
    const centerX = modal.freehandPoints.reduce((sum, p) => sum + p.x, 0) / modal.freehandPoints.length;
    const centerY = modal.freehandPoints.reduce((sum, p) => sum + p.y, 0) / modal.freehandPoints.length;
    const centerPoint = { x: centerX, y: centerY };
    
    // 添加编号标签
    addNumberLabel(svg, centerPoint, annotationNumber, modal.currentColor);
    
    // 添加到标注数组
    modal.annotations.push({
        id: annotationId,
        type: 'freehand',
        points: modal.freehandPoints,
        color: modal.currentColor,
        number: annotationNumber,
        centerPoint: centerPoint
    });
    
    console.log('✅ VPE自由绘制标注已添加:', annotationId, '编号:', annotationNumber);
    console.log('📋 VPE当前标注数量:', modal.annotations.length);
    
    // 更新对象选择器
    updateObjectSelector(modal);
    
    // 重置状态
    modal.isDrawingFreehand = false;
    modal.freehandPoints = [];
    modal.currentFreehandPath = null;
}

/**
 * 更新绘制预览
 */
function updatePreview(modal, startPoint, endPoint, tool, color) {
    const drawingLayer = modal.querySelector('#drawing-layer');
    const svg = drawingLayer ? drawingLayer.querySelector('svg') : null;
    
    if (!svg) return;
    
    // 移除现有预览
    const existingPreview = svg.querySelector('.shape-preview');
    if (existingPreview) {
        existingPreview.remove();
    }
    
    let shape = null;
    
    if (tool === 'rectangle') {
        const x = Math.min(startPoint.x, endPoint.x);
        const y = Math.min(startPoint.y, endPoint.y);
        const width = Math.abs(endPoint.x - startPoint.x);
        const height = Math.abs(endPoint.y - startPoint.y);
        
        shape = createSVGElement('rect', {
            'x': x,
            'y': y,
            'width': width,
            'height': height,
            'fill': color,
            'fill-opacity': '0.3',
            'stroke': color,
            'stroke-width': '2',
            'stroke-dasharray': '5,5',
            'class': 'shape-preview'
        });
    } else if (tool === 'circle') {
        const cx = (startPoint.x + endPoint.x) / 2;
        const cy = (startPoint.y + endPoint.y) / 2;
        let rx = Math.abs(endPoint.x - startPoint.x) / 2;
        let ry = Math.abs(endPoint.y - startPoint.y) / 2;
        
        // Shift键控制正圆
        if (startPoint.shiftKey || endPoint.shiftKey) {
            const r = Math.min(rx, ry);
            rx = r;
            ry = r;
        }
        
        shape = createSVGElement('ellipse', {
            'cx': cx,
            'cy': cy,
            'rx': rx,
            'ry': ry,
            'fill': color,
            'fill-opacity': '0.3',
            'stroke': color,
            'stroke-width': '2',
            'stroke-dasharray': '5,5',
            'class': 'shape-preview'
        });
    } else if (tool === 'arrow') {
        shape = createSVGElement('line', {
            'x1': startPoint.x,
            'y1': startPoint.y,
            'x2': endPoint.x,
            'y2': endPoint.y,
            'stroke': color,
            'stroke-width': '4',
            'stroke-dasharray': '5,5',
            'marker-end': `url(#arrowhead-${color.replace('#', '')})`,
            'class': 'shape-preview'
        });
    }
    
    if (shape) {
        svg.appendChild(shape);
    }
}

/**
 * 完成绘制
 */
function finishDrawing(modal, startPoint, endPoint, tool, color) {
    const drawingLayer = modal.querySelector('#drawing-layer');
    const svg = drawingLayer ? drawingLayer.querySelector('svg') : null;
    
    if (!svg) return;
    
    // 移除预览
    const existingPreview = svg.querySelector('.shape-preview');
    if (existingPreview) {
        existingPreview.remove();
    }
    
    let shape = null;
    const annotationId = generateId('annotation');
    
    if (tool === 'rectangle') {
        const x = Math.min(startPoint.x, endPoint.x);
        const y = Math.min(startPoint.y, endPoint.y);
        const width = Math.abs(endPoint.x - startPoint.x);
        const height = Math.abs(endPoint.y - startPoint.y);
        
        if (width < 5 || height < 5) {
            console.log('VPE矩形太小，忽略');
            return;
        }
        
        shape = createSVGElement('rect', {
            'x': x,
            'y': y,
            'width': width,
            'height': height,
            'fill': color,
            'fill-opacity': '0.5',
            'stroke': 'none',
            'class': 'annotation-shape',
            'data-annotation-id': annotationId
        });
        
    } else if (tool === 'circle') {
        const cx = (startPoint.x + endPoint.x) / 2;
        const cy = (startPoint.y + endPoint.y) / 2;
        let rx = Math.abs(endPoint.x - startPoint.x) / 2;
        let ry = Math.abs(endPoint.y - startPoint.y) / 2;
        
        // Shift键控制正圆
        if (startPoint.shiftKey || endPoint.shiftKey) {
            const r = Math.min(rx, ry);
            rx = r;
            ry = r;
            console.log('VPE按下Shift键，绘制正圆:', r);
        } else {
            console.log('VPE绘制椭圆:', { rx, ry });
        }
        
        if (rx < 5 || ry < 5) {
            console.log('VPE椭圆太小，忽略');
            return;
        }
        
        shape = createSVGElement('ellipse', {
            'cx': cx,
            'cy': cy,
            'rx': rx,
            'ry': ry,
            'fill': color,
            'fill-opacity': '0.5',
            'stroke': 'none',
            'class': 'annotation-shape',
            'data-annotation-id': annotationId
        });
        
    } else if (tool === 'arrow') {
        shape = createSVGElement('line', {
            'x1': startPoint.x,
            'y1': startPoint.y,
            'x2': endPoint.x,
            'y2': endPoint.y,
            'stroke': color,
            'stroke-width': '6',
            'marker-end': `url(#arrowhead-${color.replace('#', '')})`,
            'class': 'annotation-shape',
            'data-annotation-id': annotationId
        });
    }
    
    if (shape) {
        // 初始化annotations数组
        if (!modal.annotations) {
            modal.annotations = [];
        }
        
        // 获取正确的编号（考虑已恢复的annotations）
        const annotationNumber = getNextAnnotationNumber(modal);
        
        svg.appendChild(shape);
        
        // 添加编号标签
        addNumberLabel(svg, startPoint, annotationNumber, color);
        
        // 添加到annotations数组
        modal.annotations.push({
            id: annotationId,
            type: tool,
            start: startPoint,
            end: endPoint,
            color: color,
            number: annotationNumber
        });
        
        console.log('✅ VPE标注已添加:', annotationId, '编号:', annotationNumber);
        console.log('📋 VPE当前标注数量:', modal.annotations.length);
        updateObjectSelector(modal);
    }
}

/**
 * 添加编号标签
 */
function addNumberLabel(svg, point, number, color) {
    const group = createSVGElement('g', {
        'class': 'annotation-label',
        'data-annotation-number': number
    });
    
    // 优化位置 - 在标注左上角
    const labelX = point.x + 5;
    const labelY = point.y - 5;
    
    // 背景圆形 - 更大更明显
    const circle = createSVGElement('circle', {
        'cx': labelX,
        'cy': labelY,
        'r': '18',
        'fill': '#000',
        'fill-opacity': '0.8',
        'stroke': '#fff',
        'stroke-width': '3'
    });
    
    // 内部彩色圆形
    const innerCircle = createSVGElement('circle', {
        'cx': labelX,
        'cy': labelY,
        'r': '14',
        'fill': color,
        'fill-opacity': '0.9'
    });
    
    // 数字文本 - 更大更显眼
    const text = createSVGElement('text', {
        'x': labelX,
        'y': labelY + 5,
        'text-anchor': 'middle',
        'fill': '#fff',
        'font-family': 'Arial, sans-serif',
        'font-size': '16',
        'font-weight': 'bold',
        'text-shadow': '1px 1px 2px rgba(0,0,0,0.8)'
    });
    text.textContent = number.toString();
    
    group.appendChild(circle);
    group.appendChild(innerCircle);
    group.appendChild(text);
    svg.appendChild(group);
    
    console.log('🔢 VPE添加编号标签:', number, '位置:', { labelX, labelY });
}


/**
 * 更新对象选择器
 */
function updateObjectSelector(modal) {
    const annotationObjectsContainer = modal.querySelector('#annotation-objects');
    console.log('🔍 VPE更新选择器检查:', {
        annotationObjectsContainer: !!annotationObjectsContainer,
        annotations: modal.annotations?.length || 0
    });
    
    if (!annotationObjectsContainer) return;
    
    if (!modal.annotations || modal.annotations.length === 0) {
        annotationObjectsContainer.innerHTML = `
            <div style="color: #888; text-align: center; padding: 12px; font-size: 10px;">
                No annotation objects<br>
                <small>Annotations will appear here after creation</small>
            </div>
        `;
        return;
    }
    
    // 清空现有内容
    annotationObjectsContainer.innerHTML = '';
    
    // 为每个标注创建复选框
    modal.annotations.forEach((annotation, index) => {
        const objectInfo = getObjectInfo(annotation, index);
        
        const objectItem = document.createElement('div');
        objectItem.style.cssText = 'margin: 2px 0;';
        
        objectItem.innerHTML = `
            <label style="display: flex; align-items: center; cursor: pointer; color: white; font-size: 11px; padding: 4px; border-radius: 3px; transition: background 0.2s;" 
                   onmouseover="this.style.background='rgba(255,255,255,0.1)'" 
                   onmouseout="this.style.background='transparent'">
                <input type="checkbox" value="annotation_${index}" 
                       data-annotation-id="${annotation.id}" 
                       style="margin-right: 6px; transform: scale(1.1);">
                <span style="flex: 1;">${objectInfo.icon} ${objectInfo.description}</span>
            </label>
        `;
        
        annotationObjectsContainer.appendChild(objectItem);
    });
    
    // 绑定事件（如果还没绑定）
    if (!modal.multiSelectEventsBound) {
        bindMultiSelectEvents(modal);
        modal.multiSelectEventsBound = true;
    }
    
    
    console.log('✅ 对象选择列表已更新，共', modal.annotations.length, '个标注');
}

/**
 * 获取对象信息
 */
function getObjectInfo(annotation, index) {
    const { type: tool, color } = annotation;
    
    const colorInfo = COLOR_NAMES[color] || { name: 'Default', icon: '⚪' };
    const toolInfo = TOOL_NAMES[tool] || { name: tool, icon: '❓' };
    
    // 计算位置信息和尺寸信息
    let centerX, centerY, sizeInfo = '';
    
    if (tool === 'freehand') {
        // 自由绘制：使用中心点和点数
        if (annotation.centerPoint) {
            centerX = Math.round(annotation.centerPoint.x);
            centerY = Math.round(annotation.centerPoint.y);
        } else if (annotation.points && annotation.points.length > 0) {
            centerX = Math.round(annotation.points.reduce((sum, p) => sum + p.x, 0) / annotation.points.length);
            centerY = Math.round(annotation.points.reduce((sum, p) => sum + p.y, 0) / annotation.points.length);
        }
        sizeInfo = ` ${annotation.points?.length || 0}点`;
    } else {
        // 其他形状：使用start和end点，或从geometry获取
        const { start: startPoint, end: endPoint } = annotation;
        
        // 安全检查：确保startPoint和endPoint存在
        if (startPoint && endPoint && startPoint.x !== undefined && endPoint.x !== undefined) {
            centerX = Math.round((startPoint.x + endPoint.x) / 2);
            centerY = Math.round((startPoint.y + endPoint.y) / 2);
            
            if (tool === 'rectangle') {
                const width = Math.abs(endPoint.x - startPoint.x);
                const height = Math.abs(endPoint.y - startPoint.y);
                sizeInfo = ` ${Math.round(width)}×${Math.round(height)}`;
            }
        } else if (annotation.geometry && annotation.geometry.coordinates) {
            // 从geometry.coordinates计算中心点
            const coords = annotation.geometry.coordinates;
            if (coords.length >= 4) {
                centerX = Math.round((coords[0] + coords[2]) / 2);
                centerY = Math.round((coords[1] + coords[3]) / 2);
                
                if (tool === 'rectangle') {
                    const width = Math.abs(coords[2] - coords[0]);
                    const height = Math.abs(coords[3] - coords[1]);
                    sizeInfo = ` ${Math.round(width)}×${Math.round(height)}`;
                }
            }
        } else {
            // 默认值
            centerX = 0;
            centerY = 0;
            sizeInfo = ' (unknown size)';
            console.warn('⚠️ annotation缺少位置数据:', annotation);
        }
        
        if (tool === 'circle') {
            if (startPoint && endPoint && startPoint.x !== undefined && endPoint.x !== undefined) {
                const radiusX = Math.abs(endPoint.x - startPoint.x) / 2;
                const radiusY = Math.abs(endPoint.y - startPoint.y) / 2;
                if (Math.abs(radiusX - radiusY) < 5) {
                    sizeInfo = ` r=${Math.round(radiusX)}`;
                } else {
                    sizeInfo = ` ${Math.round(radiusX)}×${Math.round(radiusY)}`;
                }
            } else if (annotation.geometry && annotation.geometry.coordinates) {
                const coords = annotation.geometry.coordinates;
                if (coords.length >= 4) {
                    const radiusX = Math.abs(coords[2] - coords[0]) / 2;
                    const radiusY = Math.abs(coords[3] - coords[1]) / 2;
                    if (Math.abs(radiusX - radiusY) < 5) {
                        sizeInfo = ` r=${Math.round(radiusX)}`;
                    } else {
                        sizeInfo = ` ${Math.round(radiusX)}×${Math.round(radiusY)}`;
                    }
                }
            }
        } else if (tool === 'arrow') {
            if (startPoint && endPoint && startPoint.x !== undefined && endPoint.x !== undefined) {
                const length = Math.sqrt(Math.pow(endPoint.x - startPoint.x, 2) + Math.pow(endPoint.y - startPoint.y, 2));
                sizeInfo = ` L=${Math.round(length)}`;
            } else if (annotation.geometry && annotation.geometry.coordinates) {
                const coords = annotation.geometry.coordinates;
                if (coords.length >= 4) {
                    const length = Math.sqrt(Math.pow(coords[2] - coords[0], 2) + Math.pow(coords[3] - coords[1], 2));
                    sizeInfo = ` L=${Math.round(length)}`;
                }
            }
        }
    }
    
    return {
        icon: `${colorInfo.icon}${toolInfo.icon}`,
        description: `[${index}] ${colorInfo.name}${toolInfo.name}${sizeInfo} (${centerX},${centerY})`,
        colorName: colorInfo.name,
        toolName: toolInfo.name
    };
}

/**
 * 绑定多选事件
 */
function bindMultiSelectEvents(modal) {
    // 全选按钮事件
    const selectAllBtn = modal.querySelector('#select-all-objects');
    if (selectAllBtn) {
        selectAllBtn.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            const annotationCheckboxes = modal.querySelectorAll('#annotation-objects input[type="checkbox"]');
            
            annotationCheckboxes.forEach(checkbox => {
                checkbox.checked = isChecked;
            });
            
            // 更新视觉高亮
            updateMultiSelection(modal);
            console.log(isChecked ? '✅ 全选所有标注' : '❌ 取消全选');
        });
    }
    
    // 标注复选框事件
    const annotationContainer = modal.querySelector('#annotation-objects');
    if (annotationContainer) {
        annotationContainer.addEventListener('change', (e) => {
            if (e.target.type === 'checkbox' && e.target.dataset.annotationId) {
                updateMultiSelection(modal);
                
                // 更新全选状态
                const allCheckboxes = modal.querySelectorAll('#annotation-objects input[type="checkbox"]');
                const checkedCount = modal.querySelectorAll('#annotation-objects input[type="checkbox"]:checked').length;
                const selectAllBtn = modal.querySelector('#select-all-objects');
                
                if (selectAllBtn) {
                    selectAllBtn.checked = checkedCount === allCheckboxes.length;
                    selectAllBtn.indeterminate = checkedCount > 0 && checkedCount < allCheckboxes.length;
                }
            }
        });
    }
    
    // 工具栏图层选择器事件
    const layerSelect = modal.querySelector('#vpe-layer-select');
    if (layerSelect) {
        layerSelect.addEventListener('change', (e) => {
            const selectedLayerId = e.target.value;
            if (selectedLayerId) {
                // 清除所有选择
                const allCheckboxes = modal.querySelectorAll('#annotation-objects input[type="checkbox"]');
                allCheckboxes.forEach(checkbox => checkbox.checked = false);
                
                // 选择指定图层
                const targetCheckbox = modal.querySelector(`#annotation-objects input[data-annotation-id="${selectedLayerId}"]`);
                if (targetCheckbox) {
                    targetCheckbox.checked = true;
                }
                
                updateMultiSelection(modal);
                console.log('🎯 工具栏选择图层:', selectedLayerId);
            }
        });
    }
    
    // 工具栏全选按钮事件
    const toolbarSelectAll = modal.querySelector('#vpe-select-all');
    if (toolbarSelectAll) {
        toolbarSelectAll.addEventListener('click', (e) => {
            const allCheckboxes = modal.querySelectorAll('#annotation-objects input[type="checkbox"]');
            const checkedCount = modal.querySelectorAll('#annotation-objects input[type="checkbox"]:checked').length;
            const shouldSelectAll = checkedCount === 0 || checkedCount < allCheckboxes.length;
            
            allCheckboxes.forEach(checkbox => {
                checkbox.checked = shouldSelectAll;
            });
            
            // 更新主全选按钮状态
            const selectAllBtn = modal.querySelector('#select-all-objects');
            if (selectAllBtn) {
                selectAllBtn.checked = shouldSelectAll;
                selectAllBtn.indeterminate = false;
            }
            
            updateMultiSelection(modal);
            console.log(shouldSelectAll ? '✅ 工具栏全选' : '❌ 工具栏取消全选');
        });
    }
}

/**
 * 更新多选状态
 */
function updateMultiSelection(modal) {
    const selectedAnnotationIds = getSelectedAnnotationIds(modal);
    console.log('🎯 VPE当前选中的标注:', selectedAnnotationIds);
    
    // 更新视觉高亮
    highlightSelectedAnnotations(modal, selectedAnnotationIds);
    
    // 更新选中计数显示
    updateSelectionCount(modal, selectedAnnotationIds.length);
    
}

/**
 * 获取选中的标注ID列表
 */
function getSelectedAnnotationIds(modal) {
    const checkedBoxes = modal.querySelectorAll('#annotation-objects input[type="checkbox"]:checked');
    return Array.from(checkedBoxes).map(checkbox => checkbox.dataset.annotationId).filter(id => id);
}

/**
 * 高亮选中的标注
 */
function highlightSelectedAnnotations(modal, selectedIds) {
    const svg = modal.querySelector('#drawing-layer svg');
    if (!svg) return;
    
    // 清除所有选中状态
    svg.querySelectorAll('.annotation-shape').forEach(shape => {
        shape.setAttribute('stroke-width', '3');
        shape.classList.remove('selected');
    });
    
    svg.querySelectorAll('.annotation-label circle').forEach(circle => {
        circle.setAttribute('stroke', '#fff');
        circle.setAttribute('stroke-width', '3');
    });
    
    // 高亮选中的标注
    selectedIds.forEach(annotationId => {
        const targetShape = svg.querySelector(`[data-annotation-id="${annotationId}"]`);
        if (targetShape) {
            targetShape.setAttribute('stroke-width', '6');
            targetShape.classList.add('selected');
            
            // 高亮对应的编号标签
            const annotation = modal.annotations?.find(ann => ann.id === annotationId);
            if (annotation) {
                const label = svg.querySelector(`[data-annotation-number="${annotation.number}"]`);
                if (label) {
                    const circle = label.querySelector('circle');
                    if (circle) {
                        circle.setAttribute('stroke', '#ffff00');
                        circle.setAttribute('stroke-width', '4');
                    }
                }
            }
        }
    });
    
    console.log('✅ VPE已高亮', selectedIds.length, '个标注');
}

/**
 * 更新选中计数显示
 */
function updateSelectionCount(modal, count) {
    const selectionCountElement = modal.querySelector('#selection-count');
    if (selectionCountElement) {
        if (count === 0) {
            selectionCountElement.textContent = '0 selected';
            selectionCountElement.style.color = '#888';
        } else {
            selectionCountElement.textContent = `${count} selected`;
            selectionCountElement.style.color = '#4CAF50';
        }
    }
    
    console.log(`📊 VPE选中计数: ${count} 个标注`);
}

/**
 * 选中指定标注（保留单选功能）
 */
function selectAnnotationById(modal, annotationId) {
    if (!annotationId) return;
    
    // 清除所有复选框选中状态
    const checkboxes = modal.querySelectorAll('#annotation-objects input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = false);
    
    // 选中指定的复选框
    const targetCheckbox = modal.querySelector(`#annotation-objects input[data-annotation-id="${annotationId}"]`);
    if (targetCheckbox) {
        targetCheckbox.checked = true;
    }
    
    // 更新多选状态
    updateMultiSelection(modal);
    
    console.log('🎯 VPE单独选中标注:', annotationId);
}

/**
 * 滚动到指定标注
 */
function scrollToAnnotation(modal, shape) {
    try {
        const scrollCanvasContainer = modal.querySelector('#canvas-container');
        const zoomContainer = modal.querySelector('#zoom-container');
        
        if (!scrollCanvasContainer || !zoomContainer || !shape) return;
        
        // 获取标注的位置
        const shapeBBox = shape.getBBox();
        const centerX = shapeBBox.x + shapeBBox.width / 2;
        const centerY = shapeBBox.y + shapeBBox.height / 2;
        
        console.log('🎯 VPE滚动到标注位置:', { centerX, centerY });
        
        // 这里可以添加滚动逻辑
        // 暂时只是高亮显示
        
    } catch (e) {
        console.error('滚动到标注时出错:', e);
    }
}

/**
 * 添加标注到数组
 */
function addAnnotation(modal, annotation) {
    if (!modal.annotations) {
        modal.annotations = [];
    }
    
    annotation.number = modal.annotations.length;
    modal.annotations.push(annotation);
    
    updateObjectSelector(modal);
    console.log('✅ 标注已添加 ID:', annotation.id, 'type:', annotation.type);
}

/**
 * 删除指定标注 (v2.2.1 双重删除策略)
 */
export function deleteAnnotation(modal, annotation) {
    try {
        // 从数组中移除
        const index = modal.annotations.findIndex(ann => ann.id === annotation.id);
        if (index !== -1) {
            modal.annotations.splice(index, 1);
            console.log('📝 从数组中移除标注，剩余:', modal.annotations.length);
        }
        
        // 从SVG中移除
        const drawingLayer = modal.querySelector('#drawing-layer');
        if (drawingLayer) {
            const svg = drawingLayer.querySelector('svg');
            if (svg) {
                // 移除标注形状
                const shapeElement = svg.querySelector(`[data-annotation-id="${annotation.id}"]`);
                if (shapeElement) {
                    shapeElement.remove();
                    console.log('🗑️ 移除SVG形状元素');
                }
                
                // 移除相关标签 - 增强版本（优先按编号删除）
                console.log('🔍 查找并删除相关标签...', {
                    annotationId: annotation.id,
                    annotationNumber: annotation.number
                });
                
                let removedLabelCount = 0;
                
                // 方法1: 优先按编号删除（最可靠）
                if (annotation.number !== undefined) {
                    console.log('🔍 尝试按编号删除标签:', annotation.number);
                    const numberLabels = svg.querySelectorAll(`[data-annotation-number="${annotation.number}"]`);
                    console.log('📊 找到', numberLabels.length, '个编号标签');
                    
                    numberLabels.forEach((label, index) => {
                        console.log(`🗑️ 删除编号标签 ${index}:`, label.tagName);
                        label.remove();
                        removedLabelCount++;
                    });
                    
                    console.log('📊 按编号删除了', removedLabelCount, '个标签');
                }
                
                // 方法2: 如果按编号没找到，再按位置查找
                if (removedLabelCount === 0) {
                    console.log('🔍 按编号未找到标签，尝试按位置查找...');
                    const labels = svg.querySelectorAll('circle, text');
                    console.log('📊 总共找到', labels.length, '个标签元素');
                    
                    labels.forEach((label, index) => {
                        const isNear = isLabelNearAnnotation(label, annotation);
                        if (isNear) {
                            console.log(`🗑️ 按位置删除标签 ${index}:`, label.tagName);
                            label.remove();
                            removedLabelCount++;
                        }
                    });
                    
                    console.log('📊 按位置删除了', removedLabelCount, '个标签');
                }
                
                console.log('✅ 标签删除总计:', removedLabelCount, '个');
            }
        }
        
        // 更新对象选择器
        updateObjectSelector(modal);
        
        console.log('✅ 标注删除完成');
        
    } catch (e) {
        console.error('❌ 删除标注失败:', e);
    }
}

/**
 * 判断标签是否靠近指定标注
 */
function isLabelNearAnnotation(labelElement, annotation) {
    try {
        const tolerance = 20; // 容差像素
        
        if (labelElement.tagName.toLowerCase() === 'circle') {
            const cx = parseFloat(labelElement.getAttribute('cx'));
            const cy = parseFloat(labelElement.getAttribute('cy'));
            
            // 计算标注的参考位置
            let refX, refY;
            if (annotation.start && annotation.end) {
                refX = Math.min(annotation.start.x, annotation.end.x) + 5;
                refY = Math.min(annotation.start.y, annotation.end.y) + 15;
            } else if (annotation.points && annotation.points.length > 0) {
                refX = annotation.points[0].x + 5;
                refY = annotation.points[0].y + 15;
            } else {
                return false;
            }
            
            const distance = Math.sqrt(Math.pow(cx - refX, 2) + Math.pow(cy - refY, 2));
            return distance <= tolerance;
        }
        
        return false;
    } catch (e) {
        console.error('判断标签位置时出错:', e);
        return false;
    }
}