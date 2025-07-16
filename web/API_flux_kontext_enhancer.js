/**
 * APIFluxKontextEnhancer 前端JavaScript扩展
 * 
 * 实现动态guidance联动和placeholder更新
 */

import { app } from "../../scripts/app.js";

/**
 * 获取引导模板内容用于placeholder
 * @param {string} guidanceStyle - 引导风格
 * @param {string} guidanceTemplate - 引导模板
 * @returns {string} placeholder文本
 */
function getTemplateContentForPlaceholder(guidanceStyle, guidanceTemplate) {
    // Preset guidance style content
    const presetGuidance = {
        "efficient_concise": {
            "name": "Efficient Concise Mode",
            "prompt": "You are an efficient AI editor focused on clear, concise Flux Kontext instructions. Generate direct, actionable editing commands..."
        },
        "natural_creative": {
            "name": "Natural Creative Mode",
            "prompt": "You are a creative AI assistant specializing in artistic image editing with Flux Kontext. Focus on natural expression and artistic enhancement..."
        },
        "technical_precise": {
            "name": "Technical Precise Mode",
            "prompt": "You are a technical specialist for Flux Kontext image editing, focused on precision and accuracy. Generate technically precise, unambiguous editing instructions..."
        }
    };
    
    // Template library content
    const templateLibrary = {
        "ecommerce_product": {
            "name": "E-commerce Product Editing",
            "prompt": "You are a professional e-commerce product image editing AI, focused on product display optimization. Maintain product authenticity, avoid over-retouching..."
        },
        "portrait_beauty": {
            "name": "Portrait Beauty Editing",
            "prompt": "You are a professional portrait photography post-processing expert, focused on natural beautification. Maintain natural expressions, avoid excessive beauty filtering..."
        },
        "creative_design": {
            "name": "Creative Design Editing",
            "prompt": "You are a creative designer AI, specializing in artistic image processing. Bold color usage and visual impact..."
        },
        "architecture_photo": {
            "name": "Architecture Photography Editing",
            "prompt": "You are a professional architectural photography post-processing expert, focused on building and spatial aesthetics. Emphasize architectural lines and geometric beauty..."
        },
        "food_photography": {
            "name": "Food Photography Editing",
            "prompt": "You are a professional food photographer, focused on appetizing food presentation. Highlight freshness and appealing textures..."
        },
        "fashion_retail": {
            "name": "Fashion Retail Editing",
            "prompt": "You are a fashion retail visual expert, focused on perfect presentation of clothing and accessories. Highlight garment fit and design details..."
        },
        "landscape_nature": {
            "name": "Landscape Nature Editing",
            "prompt": "You are a natural landscape photography expert, focused on beautiful presentation of nature. Maintain realistic feel and beauty of natural scenery..."
        }
    };
    
    try {
        // 根据guidance_style选择内容
        if (guidanceStyle === "custom") {
            // Custom mode retains complete prompt text
            return `Enter your custom AI guidance instructions...

For example:
You are a professional image editing expert. Please convert annotation data into clear and concise editing instructions. Focus on:
1. Keep instructions concise
2. Ensure precise operations
3. Maintain style consistency

For more examples, please check guidance_template options.`;
        } else if (guidanceStyle === "template") {
            if (guidanceTemplate && guidanceTemplate !== "none" && templateLibrary[guidanceTemplate]) {
                const template = templateLibrary[guidanceTemplate];
                const preview = template.prompt.substring(0, 200).replace(/\n/g, ' ').trim();
                return `Current template: ${template.name}\n\n${preview}...`;
            } else {
                return "Preview will be displayed here after selecting a template...";
            }
        } else {
            // Display preset style content
            if (presetGuidance[guidanceStyle]) {
                const preset = presetGuidance[guidanceStyle];
                const preview = preset.prompt.substring(0, 200).replace(/\n/g, ' ').trim();
                return `Current style: ${preset.name}\n\n${preview}...`;
            } else {
                return `Enter your custom AI guidance instructions...

For example:
You are a professional image editing expert. Please convert annotation data into clear and concise editing instructions. Focus on:
1. Keep instructions concise
2. Ensure precise operations
3. Maintain style consistency

For more examples, please check guidance_template options.`;
            }
        }
    } catch (error) {
        console.error("Failed to get template content:", error);
        return `输入您的自定义AI引导指令...

例如：
你是专业的图像编辑专家，请将标注数据转换为简洁明了的编辑指令。重点关注：
1. 保持指令简洁
2. 确保操作精确
3. 维持风格一致性

更多示例请查看guidance_template选项。`;
    }
}

/**
 * 设置引导widget之间的交互
 * @param {Object} node - ComfyUI节点实例
 * @param {Object} guidanceStyleWidget - 引导风格widget
 * @param {Object} guidanceTemplateWidget - 引导模板widget
 * @param {Object} customGuidanceWidget - 自定义引导widget
 */
function setupGuidanceWidgetsInteraction(node, guidanceStyleWidget, guidanceTemplateWidget, customGuidanceWidget) {
    if (!guidanceStyleWidget || !customGuidanceWidget) {
        console.warn("⚠️ Required widgets not found for guidance interaction setup");
        return;
    }

    console.log("🔗 Setting up guidance widgets interaction");

    // 保存原始回调
    const originalStyleCallback = guidanceStyleWidget.callback;
    const originalTemplateCallback = guidanceTemplateWidget?.callback;

    // 更新placeholder的函数
    function updateCustomGuidancePlaceholder() {
        try {
            const currentStyle = guidanceStyleWidget.value;
            const currentTemplate = guidanceTemplateWidget ? guidanceTemplateWidget.value : "none";
            
            console.log(`🔄 Updating placeholder for style: ${currentStyle}, template: ${currentTemplate}`);
            
            const newPlaceholder = getTemplateContentForPlaceholder(currentStyle, currentTemplate);
            
            if (customGuidanceWidget.inputEl) {
                customGuidanceWidget.inputEl.placeholder = newPlaceholder;
                console.log("✅ Placeholder updated successfully");
            } else {
                console.warn("⚠️ Custom guidance input element not found");
            }
            
            // 强制重绘
            if (node.graph && node.graph.canvas) {
                node.graph.canvas.setDirty(true);
            }
        } catch (error) {
            console.error("❌ Error updating custom guidance placeholder:", error);
        }
    }

    // 设置引导风格变化回调
    guidanceStyleWidget.callback = function(value, ...args) {
        console.log(`🎨 Guidance style changed to: ${value}`);
        
        // 更新placeholder
        setTimeout(updateCustomGuidancePlaceholder, 100);
        
        // 调用原始回调
        if (originalStyleCallback) {
            originalStyleCallback.apply(this, [value, ...args]);
        }
    };

    // 设置引导模板变化回调
    if (guidanceTemplateWidget) {
        guidanceTemplateWidget.callback = function(value, ...args) {
            console.log(`📋 Guidance template changed to: ${value}`);
            
            // 更新placeholder
            setTimeout(updateCustomGuidancePlaceholder, 100);
            
            // 调用原始回调
            if (originalTemplateCallback) {
                originalTemplateCallback.apply(this, [value, ...args]);
            }
        };
    }

    // 初始化placeholder
    setTimeout(updateCustomGuidancePlaceholder, 200);
    
    console.log("✅ Guidance widgets interaction setup completed");
}

// 注册ComfyUI扩展
app.registerExtension({
    name: "Kontext.APIEnhancer.Extension",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "APIFluxKontextEnhancer") {
            return;
        }
        
        const onConstructed = nodeType.prototype.onConstructed;
        nodeType.prototype.onConstructed = function () {
            const r = onConstructed?.apply(this, arguments);

            // Set node color
            this.color = "#673AB7";
            this.bgcolor = "#512DA8";

            // 使用setTimeout延迟执行，确保DOM元素已准备好
            setTimeout(() => {
                try {
                    // 保存按钮功能增强
                    const saveGuidanceNameWidget = this.widgets.find(w => w.name === "save_guidance_name");
                    const saveGuidanceButtonWidget = this.widgets.find(w => w.name === "save_guidance_button");

                    if (saveGuidanceNameWidget && saveGuidanceButtonWidget && saveGuidanceNameWidget.inputEl) {
                        if (saveGuidanceNameWidget.inputEl.parentElement.classList.contains('kontext-save-container')) {
                            return;
                        }

                        saveGuidanceButtonWidget.type = "button";
                        saveGuidanceButtonWidget.callback = () => {
                            saveGuidanceButtonWidget.value = true;
                            app.graph.runStep(1, false);
                            setTimeout(() => {
                                saveGuidanceButtonWidget.value = false;
                            }, 100);
                        };

                        const saveContainer = document.createElement("div");
                        saveContainer.className = "kontext-save-container";
                        saveContainer.style.display = "flex";
                        saveContainer.style.alignItems = "center";
                        saveContainer.style.gap = "5px";

                        const nameInput = saveGuidanceNameWidget.inputEl;
                        const parent = nameInput.parentElement;
                        saveContainer.appendChild(nameInput);

                        const buttonElement = document.createElement("button");
                        buttonElement.innerText = "Save Guidance";
                        buttonElement.style.cssText = `padding: 5px; border: 1px solid #555; background-color: #444; color: white; border-radius: 3px; cursor: pointer;`;
                        
                        buttonElement.onclick = () => {
                            if (saveGuidanceNameWidget.value) {
                                saveGuidanceButtonWidget.callback();
                            } else {
                                alert("Please enter a name for the guidance.");
                            }
                        };
                        saveContainer.appendChild(buttonElement);

                        if (saveGuidanceButtonWidget.inputEl && saveGuidanceButtonWidget.inputEl.parentElement) {
                            saveGuidanceButtonWidget.inputEl.parentElement.style.display = 'none';
                        }
                        
                        parent.appendChild(saveContainer);
            } else {
                        console.warn("⚠️ API Enhancer: Save guidance widgets not found, skipping interaction setup.");
                    }
                } catch (e) {
                    console.error("Error enhancing guidance widgets for API node:", e);
            }
            }, 0);

            return r;
        };
    }
});

// 导出工具函数供其他模块使用
export {
    getTemplateContentForPlaceholder,
    setupGuidanceWidgetsInteraction
};