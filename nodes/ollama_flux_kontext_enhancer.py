"""
OllamaFluxKontextEnhancer Node
Ollama集成的Flux Kontext提示词增强节点

将VisualPromptEditor的标注数据通过本地Ollama模型转换为
Flux Kontext优化的结构化编辑指令
"""

import json
import time
import traceback
from typing import Dict, List, Any, Tuple, Optional
from datetime import datetime

try:
    from ollama import Client
    OLLAMA_AVAILABLE = True
except ImportError:
    OLLAMA_AVAILABLE = False
    print("Warning: ollama package not found. Please install with: pip install ollama")

try:
    from aiohttp import web
    from server import PromptServer
    WEB_AVAILABLE = True
except ImportError:
    WEB_AVAILABLE = False


class OllamaFluxKontextEnhancerV2:
    """
    🤖 Ollama Flux Kontext Enhancer
    
    通过本地Ollama模型将VisualPromptEditor的标注数据
    转换为Flux Kontext优化的结构化编辑指令
    """
    
    # 类级别的缓存变量
    _cached_models = None
    _cache_timestamp = 0
    _cache_duration = 5  # 缓存5秒，快速更新新模型
    _last_successful_url = None  # 记录最后一次成功的URL
    
    
    @classmethod
    def get_available_models(cls, url=None, force_refresh=False):
        """动态获取可用的Ollama模型列表 - 通用版本，支持任何已安装的模型"""
        
        import time
        import os
        current_time = time.time()
        
        # 动态获取Ollama URL配置
        if url is None:
            # 优先级：环境变量 > 配置文件 > 默认值
            url = (os.getenv('OLLAMA_URL') or 
                   os.getenv('OLLAMA_HOST') or 
                   os.getenv('OLLAMA_BASE_URL') or 
                   "http://127.0.0.1:11434")
        
        # Check if cache is valid
        if (not force_refresh and 
            cls._cached_models is not None and 
            current_time - cls._cache_timestamp < cls._cache_duration):
            return cls._cached_models
        
        def try_http_api(api_url):
            """Try to get model list via HTTP API"""
            try:
                import requests
                response = requests.get(f"{api_url}/api/tags", timeout=10)
                if response.status_code == 200:
                    models_data = response.json()
                    models = models_data.get('models', [])
                    
                    model_names = []
                    for model in models:
                        if isinstance(model, dict):
                            # Try multiple possible field names
                            name = (model.get('name') or 
                                   model.get('model') or 
                                   model.get('id') or 
                                   model.get('model_id'))
                            if name:
                                model_names.append(name)
                    
                    return model_names
            except Exception as e:
                print(f"HTTP API detection failed: {e}")
                return []
        
        def try_ollama_client(api_url):
            """Try to get model list via Ollama client"""
            try:
                if not OLLAMA_AVAILABLE:
                    return []
                
                from ollama import Client
                client = Client(host=api_url)
                models_response = client.list()
                
                if isinstance(models_response, dict):
                    models = models_response.get('models', [])
                elif hasattr(models_response, 'models'):
                    models = models_response.models
                else:
                    models = []
                
                model_names = []
                for model in models:
                    name = None
                    
                    if isinstance(model, dict):
                        name = (model.get('name') or 
                               model.get('model') or 
                               model.get('id'))
                    elif hasattr(model, 'name'):
                        name = model.name
                    elif hasattr(model, 'model'):
                        name = model.model
                    else:
                        # 尝试从字符串表示中提取模型名
                        model_str = str(model)
                        if "name=" in model_str or "model=" in model_str:
                            # 支持多种格式: name='xxx', model='xxx'
                            for prefix in ["name='", "model='"]:
                                if prefix in model_str:
                                    start = model_str.find(prefix) + len(prefix)
                                    end = model_str.find("'", start)
                                    if end > start:
                                        name = model_str[start:end]
                                        break
                    
                    if name:
                        model_names.append(name)
                        print(f"✅ Ollama Client检测到模型: {name}")
                
                return model_names
                
            except Exception as e:
                print(f"Ollama Client检测失败: {e}")
                return []
        
        # Start model detection process
        print(f"Detecting Ollama models from URL: {url}")
        
        # Try multiple URL formats (smart detection)
        urls_to_try = [url]
        
        # Add common local address variants
        if url not in ["http://127.0.0.1:11434", "http://localhost:11434", "http://0.0.0.0:11434"]:
            urls_to_try.extend([
                "http://127.0.0.1:11434",
                "http://localhost:11434", 
                "http://0.0.0.0:11434"
            ])
        
        # Remove duplicates while preserving order
        urls_to_try = list(dict.fromkeys(urls_to_try))
        
        all_models = set()  # Use set to avoid duplicates
        successful_url = None
        
        for test_url in urls_to_try:
            try:
                # Method 1: HTTP API
                http_models = try_http_api(test_url)
                if http_models:
                    all_models.update(http_models)
                    successful_url = test_url
                    print(f"Found {len(http_models)} models via HTTP API from {test_url}")
                
                # Method 2: Ollama Client
                client_models = try_ollama_client(test_url)
                if client_models:
                    all_models.update(client_models)
                    successful_url = test_url
                    print(f"Found {len(client_models)} models via Ollama Client from {test_url}")
                
                # Exit early if models found
                if all_models:
                    break
                    
            except Exception as e:
                print(f"Failed to test URL {test_url}: {e}")
                continue
        
        # Convert to sorted list
        model_list = sorted(list(all_models))
        
        if model_list:
            print(f"Total {len(model_list)} unique models detected")
            
            # Update cache (including successful URL)
            cls._cached_models = model_list
            cls._cache_timestamp = current_time
            if successful_url:
                cls._last_successful_url = successful_url
            print(f"Model list cached for {cls._cache_duration} seconds")
            
            return model_list
        
        # If no models detected, return fallback
        print("Warning: No models detected, returning fallback list")
        fallback_models = ["ollama-model-not-found"]
        print("Please ensure:")
        print("   1. Ollama service is running (ollama serve)")
        print("   2. At least one model is installed (ollama pull <model_name>)")
        print("   3. Service is accessible (curl http://localhost:11434/api/tags)")
        
        # Cache fallback to avoid repeated error detection
        cls._cached_models = fallback_models
        cls._cache_timestamp = current_time
        
        return fallback_models

    @classmethod
    def refresh_model_cache(cls):
        """手动刷新模型缓存"""
        print("🔄 手动刷新模型缓存...")
        cls._cached_models = None
        cls._cache_timestamp = 0
        return cls.get_available_models(force_refresh=True)

    @classmethod
    def get_template_content_for_placeholder(cls, guidance_style, guidance_template):
        """获取模板内容用于placeholder显示"""
        try:
            # 导入guidance_templates模块
            from .guidance_templates import PRESET_GUIDANCE, TEMPLATE_LIBRARY
            
            # 根据guidance_style选择内容
            if guidance_style == "custom":
                # 自定义模式保留完整提示文字
                return """输入您的自定义AI引导指令...

例如：
你是专业的图像编辑专家，请将标注数据转换为简洁明了的编辑指令。重点关注：
1. 保持指令简洁
2. 确保操作精确
3. 维持风格一致性

更多示例请查看guidance_template选项。"""
            elif guidance_style == "template":
                if guidance_template and guidance_template != "none" and guidance_template in TEMPLATE_LIBRARY:
                    template_content = TEMPLATE_LIBRARY[guidance_template]["prompt"]
                    # 截取前200个字符用于placeholder显示
                    preview = template_content[:200].replace('\n', ' ').strip()
                    return f"当前模板: {TEMPLATE_LIBRARY[guidance_template]['name']}\n\n{preview}..."
                else:
                    return "选择一个模板后将在此显示预览..."
            else:
                # 显示预设风格的内容
                if guidance_style in PRESET_GUIDANCE:
                    preset_content = PRESET_GUIDANCE[guidance_style]["prompt"]
                    # 截取前200个字符用于placeholder显示
                    preview = preset_content[:200].replace('\n', ' ').strip()
                    return f"当前风格: {PRESET_GUIDANCE[guidance_style]['name']}\n\n{preview}..."
                else:
                    return """输入您的自定义AI引导指令...

例如：
你是专业的图像编辑专家，请将标注数据转换为简洁明了的编辑指令。重点关注：
1. 保持指令简洁
2. 确保操作精确
3. 维持风格一致性

更多示例请查看guidance_template选项。"""
        except Exception as e:
            print(f"获取模板内容失败: {e}")
            return """输入您的自定义AI引导指令...

例如：
你是专业的图像编辑专家，请将标注数据转换为简洁明了的编辑指令。重点关注：
1. 保持指令简洁
2. 确保操作精确
3. 维持风格一致性

更多示例请查看guidance_template选项。"""

    @classmethod
    def INPUT_TYPES(cls):
        # 动态获取实际可用的Ollama模型列表，每次都强制刷新以获取最新模型
        try:
            # 清空缓存确保获取最新模型列表
            cls._cached_models = None
            cls._cache_timestamp = 0
            available_models = cls.get_available_models(force_refresh=True)
            
            # 如果没有检测到模型，使用备用选项
            if not available_models or len(available_models) == 0:
                available_models = ["No models found - Start Ollama service"]
            else:
                # 在列表开头添加刷新选项
                available_models = ["🔄 Refresh model list"] + available_models
            
            # 设置默认模型为第一个实际模型（跳过刷新选项）
            if len(available_models) > 1 and available_models[0] == "🔄 Refresh model list":
                default_model = available_models[1]
            else:
                default_model = available_models[0]
            
        except Exception as e:
            print(f"Failed to get dynamic model list: {e}")
            available_models = ["Error getting models - Check Ollama"]
            default_model = available_models[0]
        
        
        # 动态生成placeholder内容
        try:
            default_placeholder = cls.get_template_content_for_placeholder("efficient_concise", "none")
        except Exception as e:
            default_placeholder = "Enter your custom AI guidance instructions..."
        
        return {
            "required": {
                "annotation_data": ("STRING", {
                    "forceInput": True,
                    "tooltip": "来自VisualPromptEditor的标注JSON数据（连接输入）"
                }),
                "edit_description": ("STRING", {
                    "multiline": True,
                    "default": "",
                    "placeholder": "描述你想做的编辑操作...\n\n例如：\n- 在红色矩形区域增加一棵树\n- 将蓝色标记区域的车辆改为红色\n- 移除圆形区域的人物\n- 将黄色区域的天空改为晩霞效果",
                    "tooltip": "描述你想要做的编辑操作，结合标注信息生成精准的编辑指令"
                }),
                "model": (available_models, {
                    "default": default_model,
                    "tooltip": "选择Ollama模型。列表实时从Ollama服务获取，显示所有当前可用的模型。"
                }),
                "edit_instruction_type": ([
                    "auto_detect",          # 🔄 自动根据操作类型选择最佳策略
                    "spatial_precise",      # 空间精准编辑
                    "semantic_enhanced",    # 语义增强编辑  
                    "style_coherent",       # 风格一致性编辑
                    "content_aware",        # 内容感知编辑
                    "multi_region",         # 多区域协调编辑
                    "custom"                # 自定义指令
                ], {
                    "default": "auto_detect",
                    "tooltip": "选择编辑指令的生成策略 (auto_detect根据操作类型自动选择)"
                }),
                "output_format": ([
                    "flux_kontext_standard",  # Flux Kontext标准格式
                    "structured_json",        # 结构化JSON
                    "natural_language"        # 自然语言描述
                ], {
                    "default": "flux_kontext_standard",
                    "tooltip": "选择输出的提示词格式"
                }),
            },
            "optional": {
                "image": ("IMAGE", {
                    "tooltip": "可选：用于视觉分析的图像（仅支持视觉模型时需要）"
                }),
                "url": ("STRING", {
                    "default": "http://127.0.0.1:11434",
                    "tooltip": "Ollama服务地址"
                }),
                "temperature": ("FLOAT", {
                    "default": 0.7,
                    "min": 0.1,
                    "max": 1.0,
                    "step": 0.1,
                    "tooltip": "生成温度 (创意性控制)"
                }),
                "language": (["chinese", "english", "bilingual"], {
                    "default": "chinese",
                    "tooltip": "选择输出语言：中文、英文或双语"
                }),
                "enable_visual_analysis": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "启用视觉分析（仅对支持视觉的多模态模型有效，如qwen-vl、llava等）"
                }),
                "guidance_style": ([
                    "efficient_concise",   # 高效简洁 (默认)
                    "natural_creative",    # 自然创意
                    "technical_precise",   # 技术精确
                    "template",           # 模板选择
                    "custom"              # 自定义
                ], {
                    "default": "efficient_concise",
                    "tooltip": "选择AI引导话术风格：高效简洁适合快速编辑，自然创意适合艺术设计，技术精确适合专业用途，模板选择常用预设，自定义允许完全控制"
                }),
                "guidance_template": ([
                    "none",               # 无模板
                    "ecommerce_product",  # 电商产品
                    "portrait_beauty",    # 人像美化
                    "creative_design",    # 创意设计
                    "architecture_photo", # 建筑摄影
                    "food_photography",   # 美食摄影
                    "fashion_retail",     # 时尚零售
                    "landscape_nature"    # 风景自然
                ], {
                    "default": "none",
                    "tooltip": "选择专用引导模板（当guidance_style为template时使用）"
                }),
                "custom_guidance": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "placeholder": default_placeholder,
                    "tooltip": "当guidance_style为'custom'时，在此输入您的专用AI引导指令。placeholder会根据当前选择的guidance_style和guidance_template动态显示预览内容。"
                })
            }
        }
    
    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        """验证输入参数"""
        model = kwargs.get('model', '')
        url = kwargs.get('url', 'http://127.0.0.1:11434')
        
        # 如果model为空，尝试获取可用模型并使用第一个
        if not model or model == '':
            available_models = cls.get_available_models(url=url)
            if available_models:
                # 返回True表示验证通过，ComfyUI会使用默认值
                return True
        
        # 检查模型是否在可用列表中，先尝试缓存的列表
        available_models = cls.get_available_models(url=url, force_refresh=False)
        if model not in available_models and model not in ["ollama-model-not-found", "请先启动Ollama服务"]:
            # 如果模型不在缓存中，强制刷新一次
            available_models = cls.get_available_models(url=url, force_refresh=True)
            if model not in available_models:
                print(f"⚠️ 模型 '{model}' 不在可用列表中: {available_models}")
                # 不返回错误，让用户知道但仍可以继续
                return True
        
        return True
    
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = (
        "flux_edit_instructions",  # Flux Kontext格式的编辑指令
        "system_prompt",           # 发送给模型的完整系统指令
    )
    
    FUNCTION = "enhance_flux_instructions"
    CATEGORY = "kontext/ai_enhanced"
    DESCRIPTION = "🤖 通过Ollama增强VisualPromptEditor的标注数据，生成Flux Kontext优化的结构化编辑指令"
    
    def __init__(self):
        self.start_time = None
        self.debug_logs = []
    
    def enhance_flux_instructions(self, annotation_data: str, edit_description: str, model: str, 
                                edit_instruction_type: str, output_format: str,
                                image=None, url: str = "http://127.0.0.1:11434", temperature: float = 0.7,
                                language: str = "chinese", enable_visual_analysis: bool = False,
                                guidance_style: str = "efficient_concise",
                                guidance_template: str = "none", custom_guidance: str = ""):
        """通过Ollama增强标注数据，生成Flux Kontext优化的编辑指令"""
        
        # 设置移除参数的默认值
        reference_context = ""
        edit_intensity = 0.8
        preservation_mask = ""
        style_guidance = ""
        top_p = 0.9
        keep_alive = 5
        debug_mode = False  # 移除debug_mode参数，固定为False
        
        
        # 导入引导话术管理器
        try:
            from .guidance_templates import guidance_manager
        except ImportError:
            # 回退到绝对导入
            import sys
            import os
            sys.path.append(os.path.dirname(__file__))
            from guidance_templates import guidance_manager
        
        # 构建系统提示词（整合引导话术和语言控制）
        enhanced_system_prompt = guidance_manager.build_system_prompt(
            guidance_style=guidance_style,
            guidance_template=guidance_template,
            custom_guidance=custom_guidance,
            load_saved_guidance="",
            language=language
        )
        print(f"Using guidance mode: {guidance_style}")
        print(f"Output language: {language}")
        print(f"Visual analysis: {'enabled' if enable_visual_analysis else 'disabled'}")
        
        print(f"Using model: {model}")
        print(f"Edit strategy: {edit_instruction_type}")
        print(f"Output format: {output_format}")
        
        # Smart model handling logic
        if model == "🔄 Refresh model list":
            # User clicked refresh, get latest model list and use first available
            print("Refreshing model list...")
            self.__class__._cached_models = None  # Clear cache
            self.__class__._cache_timestamp = 0
            available_models = self.get_available_models(url=url, force_refresh=True)
            if available_models:
                model = available_models[0]
                print(f"Model list refreshed, using: {model}")
            else:
                print("Error: No models found after refresh")
                return self._create_fallback_output("No models found after refresh", False)
        
        elif model == "custom-model-name":
            # User needs to manually input model name or add custom logic here
            print("Info: Please change this option to your actual model name")
            # Try auto-detection
            available_models = self.get_available_models(url=url, force_refresh=True)
            if available_models:
                model = available_models[0]
                print(f"Using detected model: {model}")
        
        elif model in ["No models found - Start Ollama service", "Error getting models - Check Ollama"]:
            # Handle error states
            print("Error: Please start Ollama service and ensure models are installed")
            return self._create_fallback_output("Ollama service not available or no models installed", False)
        
        else:
            # Validate if specified model is available
            available_models = self.get_available_models(url=url, force_refresh=False)
            if model not in available_models:
                print(f"Warning: Specified model {model} not available, detected models: {available_models}")
                if available_models:
                    print(f"Auto-switching to available model: {available_models[0]}")
                    model = available_models[0]
                else:
                    print("Error: No available models detected")
                    return self._create_fallback_output(f"Model {model} not available and no other models found", False)
        
        self.start_time = time.time()
        self.debug_logs = []
        
        try:
            # 检查Ollama服务可用性（通过HTTP API）
            if not self._check_ollama_service(url):
                return self._create_fallback_output(
                    f"Ollama service not available at {url}. Please start ollama service.",
                    debug_mode
                )
            
            # 自动检测最佳编辑策略
            if edit_instruction_type == "auto_detect":
                edit_instruction_type = self._auto_detect_strategy(annotation_data, debug_mode)
                self._log_debug(f"🔄 自动检测到最佳策略: {edit_instruction_type}", debug_mode)
            
            self._log_debug(f"🚀 开始处理 - 模型: {model}, 策略: {edit_instruction_type}", debug_mode)
            
            # 1. 解析标注数据
            annotations, parsed_data = self._parse_annotation_data(annotation_data, debug_mode)
            if not annotations:
                return self._create_fallback_output(
                    "No valid annotations found in annotation_data",
                    debug_mode
                )
            
            # 2. Ollama服务已通过前面的检查确认可用
            self._log_debug(f"🔗 使用Ollama服务: {url}", debug_mode)
            
            # 3. 构建用户提示词（系统提示词已在上面通过引导话术系统构建）
            user_prompt = self._build_user_prompt(
                annotations, parsed_data, edit_description, reference_context, 
                edit_intensity, preservation_mask, style_guidance
            )
            
            self._log_debug(f"📝 生成的用户提示词长度: {len(user_prompt)} 字符", debug_mode)
            
            # 4. 检查是否需要视觉分析
            image_base64 = None
            if enable_visual_analysis:
                if self._is_multimodal_model(model):
                    image_base64 = self._encode_image_for_ollama(image, debug_mode)
                    if image_base64:
                        self._log_debug("🔍 启用视觉分析模式", debug_mode)
                    else:
                        self._log_debug("⚠️ 图像编码失败，回退到纯文本模式", debug_mode)
                else:
                    self._log_debug(f"⚠️ 模型 {model} 不支持视觉分析，忽略视觉输入", debug_mode)
            
            # 5. 调用Ollama生成增强指令（使用引导话术系统构建的enhanced_system_prompt）
            enhanced_instructions = self._generate_with_ollama(
                url, model, enhanced_system_prompt, user_prompt,
                temperature, top_p, keep_alive, debug_mode, image_base64
            )
            
            if not enhanced_instructions:
                # 提供更详细的错误信息
                error_msg = f"Failed to generate enhanced instructions from Ollama. Model: {model}, URL: {url}"
                print(f"Error: {error_msg}")
                print("Troubleshooting tips:")
                print("1. Check if Ollama service is running: ollama serve")
                print("2. Verify the model is installed: ollama list")
                print(f"3. Test model manually: ollama run {model}")
                print("4. Check if the URL is accessible")
                return self._create_fallback_output(error_msg, debug_mode)
            
            # 5. 格式化输出
            flux_instructions = self._format_flux_instructions(
                enhanced_instructions, output_format, debug_mode
            )
            
            self._log_debug("✅ 处理完成", debug_mode)
            
            return (flux_instructions, enhanced_system_prompt)
            
        except Exception as e:
            error_msg = f"Error in enhance_flux_instructions: {str(e)}"
            if debug_mode:
                error_msg += f"\n{traceback.format_exc()}"
            return self._create_fallback_output(error_msg, debug_mode)
    
    def _check_ollama_service(self, url: str) -> bool:
        """检查Ollama服务是否可用"""
        try:
            import requests
            print(f"Checking Ollama service at: {url}")
            response = requests.get(f"{url}/api/tags", timeout=5)
            if response.status_code == 200:
                print("Ollama service is accessible")
                return True
            else:
                print(f"Ollama service returned status code: {response.status_code}")
                return False
        except Exception as e:
            print(f"Failed to connect to Ollama service: {e}")
            return False
    
    def _is_multimodal_model(self, model: str) -> bool:
        """检查模型是否支持视觉分析"""
        multimodal_models = [
            "qwen-vl", "qwen2-vl", "qwen:vl", "qwen2:vl",
            "llava", "llava:latest", "llava:7b", "llava:13b", "llava:34b",
            "llava-llama3", "llava-phi3", "llava-code",
            "moondream", "cogvlm", "cogvlm2",
            "yi-vl", "internvl", "minicpm-v"
        ]
        
        model_lower = model.lower()
        for mm_model in multimodal_models:
            if mm_model in model_lower:
                return True
        return False
    
    def _encode_image_for_ollama(self, image, debug_mode: bool) -> Optional[str]:
        """将图像编码为Ollama可用的base64格式"""
        try:
            import torch
            import numpy as np
            from PIL import Image
            import io
            import base64
            
            # 处理ComfyUI的图像格式 (tensor)
            if isinstance(image, torch.Tensor):
                # ComfyUI图像格式: [batch, height, width, channels]
                if image.dim() == 4:
                    image = image[0]  # 取第一张图像
                
                # 转换为numpy
                if image.dtype == torch.float32:
                    # 从[0,1]范围转换到[0,255]
                    image_np = (image * 255).clamp(0, 255).byte().cpu().numpy()
                else:
                    image_np = image.cpu().numpy()
                
                # 创建PIL图像
                pil_image = Image.fromarray(image_np, mode='RGB')
            else:
                # 如果已经是PIL图像
                pil_image = image
            
            # 转换为JPEG格式的base64
            buffer = io.BytesIO()
            pil_image.save(buffer, format='JPEG', quality=85)
            img_bytes = buffer.getvalue()
            img_base64 = base64.b64encode(img_bytes).decode('utf-8')
            
            self._log_debug(f"🖼️ 图像编码成功，base64长度: {len(img_base64)} 字符", debug_mode)
            return img_base64
            
        except Exception as e:
            self._log_debug(f"❌ 图像编码失败: {e}", debug_mode)
            return None
    
    def _auto_detect_strategy(self, annotation_data: str, debug_mode: bool) -> str:
        """根据annotation数据自动检测最佳编辑策略"""
        try:
            if not annotation_data or not annotation_data.strip():
                return "spatial_precise"  # 默认策略
            
            parsed_data = json.loads(annotation_data)
            operation_type = parsed_data.get('operation_type', '')
            
            # Visual Prompt Editor操作类型到编辑策略的映射
            operation_to_strategy = {
                # 空间精准类操作
                "change_color": "spatial_precise",
                "replace_object": "spatial_precise", 
                "resize_object": "spatial_precise",
                "geometric_warp": "spatial_precise",
                "perspective_transform": "spatial_precise",
                "precision_cutout": "spatial_precise",
                
                # 语义增强类操作
                "add_object": "semantic_enhanced",
                "remove_object": "semantic_enhanced",
                "change_expression": "semantic_enhanced",
                "character_expression": "semantic_enhanced",
                "content_aware_fill": "semantic_enhanced",
                "seamless_removal": "semantic_enhanced",
                
                # 风格一致性类操作
                "change_style": "style_coherent",
                "change_texture": "style_coherent",
                "global_style_transfer": "style_coherent",
                "style_blending": "style_coherent",
                "global_color_grade": "style_coherent",
                
                # 内容感知类操作
                "enhance_quality": "content_aware",
                "change_pose": "content_aware",
                "change_clothing": "content_aware",
                "enhance_skin_texture": "content_aware",
                "detail_enhance": "content_aware",
                "realism_enhance": "content_aware",
                
                # 多区域协调类操作（检测多个标注）
                "global_enhance": "multi_region",
                "global_filter": "multi_region",
                "collage_integration": "multi_region",
                "texture_mixing": "multi_region"
            }
            
            # 根据操作类型选择策略
            detected_strategy = operation_to_strategy.get(operation_type, "spatial_precise")
            
            # 检查是否有多个标注区域
            annotations = parsed_data.get('annotations', [])
            if len(annotations) > 2:
                detected_strategy = "multi_region"
            
            self._log_debug(f"🎯 操作类型: {operation_type} → 策略: {detected_strategy}", debug_mode)
            return detected_strategy
            
        except Exception as e:
            self._log_debug(f"⚠️ 策略自动检测失败: {e}, 使用默认策略", debug_mode)
            return "spatial_precise"
    
    def _parse_annotation_data(self, annotation_data: str, debug_mode: bool) -> Tuple[List[Dict], Dict]:
        """解析标注数据"""
        try:
            if not annotation_data or not annotation_data.strip():
                self._log_debug("⚠️ 标注数据为空", debug_mode)
                return [], {}
            
            parsed_data = json.loads(annotation_data)
            self._log_debug(f"📊 解析标注数据成功，数据类型: {type(parsed_data)}", debug_mode)
            
            # 提取annotations
            annotations = []
            if isinstance(parsed_data, dict):
                if "annotations" in parsed_data:
                    annotations = parsed_data["annotations"]
                elif "layers_data" in parsed_data:
                    annotations = parsed_data["layers_data"]
            elif isinstance(parsed_data, list):
                annotations = parsed_data
            
            self._log_debug(f"📍 提取到 {len(annotations)} 个标注", debug_mode)
            return annotations, parsed_data
            
        except json.JSONDecodeError as e:
            self._log_debug(f"❌ JSON解析失败: {e}", debug_mode)
            return [], {}
        except Exception as e:
            self._log_debug(f"❌ 标注数据解析异常: {e}", debug_mode)
            return [], {}
    
    def _connect_ollama(self, url: str, debug_mode: bool) -> Optional[object]:
        """连接Ollama服务"""
        try:
            if not OLLAMA_AVAILABLE:
                self._log_debug("❌ Ollama模块不可用", debug_mode)
                return None
                
            from ollama import Client
            client = Client(host=url)
            # 测试连接
            models = client.list()
            self._log_debug(f"🔗 Ollama连接成功，可用模型数: {len(models.get('models', []))}", debug_mode)
            return client
        except Exception as e:
            self._log_debug(f"❌ Ollama连接失败: {e}", debug_mode)
            return None
    
    def _build_system_prompt(self, edit_instruction_type: str, output_format: str) -> str:
        """构建系统提示词"""
        
        # 编辑策略说明及具体指导
        strategy_descriptions = {
            "spatial_precise": {
                "description": "专注于精确的空间位置描述和坐标定位",
                "guidance": """Focus on:
- Precise spatial positioning and coordinates
- Exact boundary definitions
- Clear geometric transformations
- Maintain spatial relationships
- Include specific pixel/region coordinates when possible"""
            },
            "semantic_enhanced": {
                "description": "强调语义理解和内容识别，生成语义丰富的编辑指令",
                "guidance": """Focus on:
- Object recognition and semantic understanding
- Context-aware content modifications
- Intelligent object relationships
- Meaningful content additions/removals
- Preserve semantic coherence"""
            },
            "style_coherent": {
                "description": "注重整体风格的协调统一，确保编辑后的视觉一致性",
                "guidance": """Focus on:
- Visual style consistency
- Color harmony and palette coherence
- Texture and material uniformity
- Lighting and shadow consistency
- Overall aesthetic unity"""
            },
            "content_aware": {
                "description": "智能理解图像内容和上下文，生成内容感知的编辑指令",
                "guidance": """Focus on:
- Context-sensitive modifications
- Content-appropriate enhancements
- Scene understanding
- Natural content integration
- Preserve content authenticity"""
            },
            "multi_region": {
                "description": "处理多个标注区域的协调关系，确保整体编辑的和谐性",
                "guidance": """Focus on:
- Coordinate multiple region edits
- Ensure region-to-region harmony
- Balance competing modifications
- Maintain overall composition
- Synchronize related changes"""
            },
            "custom": {
                "description": "根据用户需求生成自定义的编辑指令",
                "guidance": """Focus on:
- User-specific requirements
- Flexible adaptation to needs
- Custom modification approaches
- Personalized editing strategies"""
            }
        }
        
        # 输出格式说明
        format_descriptions = {
            "flux_kontext_standard": """Output EXACTLY in this format:

[EDIT_OPERATIONS]
operation_1: change the marked area to [target color/object]

[SPATIAL_CONSTRAINTS]
preserve_regions: ["background"]
blend_boundaries: "seamless"

[QUALITY_CONTROLS]
detail_level: "high"
consistency: "maintain_original_quality"
""",
            "structured_json": "输出结构化的JSON格式，包含操作、约束和质量控制信息",
            "natural_language": "输出自然流畅的语言描述，适合直接作为提示词使用"
        }
        
        # 获取当前策略的指导
        current_strategy = strategy_descriptions.get(edit_instruction_type, strategy_descriptions["spatial_precise"])
        
        system_prompt = f"""Generate image editing instructions in Flux Kontext format.

EDITING STRATEGY: {edit_instruction_type}
{current_strategy["guidance"]}

OUTPUT FORMAT:
{format_descriptions.get(output_format, "Standard format")}

Rules:
- Output ONLY the formatted instructions
- Do NOT include code, explanations, or comments
- Apply the specific editing strategy focus areas listed above
- Ensure instructions match the strategy requirements"""
        
        return system_prompt
    
    def _build_user_prompt(self, annotations: List[Dict], parsed_data: Dict,
                          edit_description: str = "", reference_context: str = "", edit_intensity: float = 0.8,
                          preservation_mask: str = "", style_guidance: str = "") -> str:
        """构建用户提示词"""
        
        prompt_parts = []
        
        # 1. 编辑意图描述（最重要的信息）
        if edit_description and edit_description.strip():
            prompt_parts.append("=== 编辑意图 ===\n用户要求: " + edit_description.strip())
        
        # 2. 图像标注信息
        prompt_parts.append("\n=== 图像标注信息 ===")
        
        # 检查是否包含编号设置
        include_numbers = parsed_data.get("include_annotation_numbers", True)
        
        for i, annotation in enumerate(annotations):
            if include_numbers:
                # 使用annotation中的number字段，如果没有则使用索引
                number = annotation.get('number', i+1)
                annotation_desc = f"标注 {number}:"
            else:
                annotation_desc = "标注:"
            
            annotation_desc += f" 类型={annotation.get('type', 'unknown')}"
            annotation_desc += f" 颜色={annotation.get('color', '#000000')}"
            
            if 'start' in annotation and 'end' in annotation:
                start = annotation['start']
                end = annotation['end']
                annotation_desc += f" 坐标=({start.get('x', 0)},{start.get('y', 0)})-({end.get('x', 0)},{end.get('y', 0)})"
            
            prompt_parts.append(annotation_desc)
        
        # 3. 操作信息
        if 'operation_type' in parsed_data:
            prompt_parts.append(f"\n=== 操作类型 ===")
            prompt_parts.append(f"操作: {parsed_data['operation_type']}")
        
        if 'target_description' in parsed_data:
            prompt_parts.append(f"目标描述: {parsed_data['target_description']}")
        
        # 4. 增强提示词
        if 'constraint_prompts' in parsed_data and parsed_data['constraint_prompts']:
            prompt_parts.append(f"\n=== 约束性提示词 ===")
            constraints = parsed_data['constraint_prompts']
            if isinstance(constraints, list):
                prompt_parts.append(", ".join(constraints))
            else:
                prompt_parts.append(str(constraints))
        
        if 'decorative_prompts' in parsed_data and parsed_data['decorative_prompts']:
            prompt_parts.append(f"\n=== 修饰性提示词 ===")
            decoratives = parsed_data['decorative_prompts']
            if isinstance(decoratives, list):
                prompt_parts.append(", ".join(decoratives))
            else:
                prompt_parts.append(str(decoratives))
        
        # 5. 参考上下文
        if reference_context:
            prompt_parts.append(f"\n=== 参考上下文 ===")
            prompt_parts.append(reference_context)
        
        # 6. 编辑参数
        prompt_parts.append(f"\n=== 编辑参数 ===")
        prompt_parts.append(f"编辑强度: {edit_intensity}")
        
        if preservation_mask:
            prompt_parts.append(f"保护区域: {preservation_mask}")
        
        if style_guidance:
            prompt_parts.append(f"风格指导: {style_guidance}")
        
        # 7. 生成要求
        prompt_parts.append(f"\n=== 生成要求 ===")
        prompt_parts.append("请根据以上信息生成优化的Flux Kontext编辑指令。")
        prompt_parts.append("确保指令精确、可执行，并符合指定的输出格式。")
        prompt_parts.append("重点根据编辑意图和标注信息的结合来生成指令。")
        
        return "\n".join(prompt_parts)
    
    def _generate_with_ollama(self, url: str, model: str, system_prompt: str,
                             user_prompt: str, temperature: float, top_p: float = 0.9,
                             keep_alive: int = 5, debug_mode: bool = False, 
                             image_base64: Optional[str] = None) -> Optional[str]:
        """使用Ollama HTTP API生成增强指令"""
        try:
            import requests
            import json
            
            self._log_debug(f"🤖 调用Ollama模型: {model} (HTTP API)", debug_mode)
            
            # 配置生成参数 - 为了提高速度，限制最大temperature
            options = {
                "temperature": min(temperature, 0.7),  # 限制最大温度为0.7以提高速度
                "top_p": min(top_p, 0.9),
            }
            
            # 为小模型添加额外的速度优化选项
            if "1.7b" in model.lower() or "1.5b" in model.lower():
                options.update({
                    "num_predict": 500,  # 限制输出长度
                    "num_ctx": 2048,     # 限制上下文长度
                })
                print(f"Applying speed optimizations for small model: {model}")
            
            # 对于qwen3等支持thinking模式的模型，在system prompt中明确要求不要thinking
            if "qwen3" in model.lower() or "qwen" in model.lower():
                # 在system prompt中明确要求不要thinking（不使用不支持的选项）
                system_prompt += "\n\nIMPORTANT: Do not include any thinking process, reasoning steps, or <think> tags in your response. Output only the final formatted instructions."
            
            # 构建请求数据
            if image_base64:
                # 对于多模态模型，使用chat API格式
                payload = {
                    "model": model,
                    "messages": [
                        {
                            "role": "system",
                            "content": system_prompt
                        },
                        {
                            "role": "user",
                            "content": user_prompt,
                            "images": [image_base64]
                        }
                    ],
                    "options": options,
                    "keep_alive": f"{keep_alive}m",
                    "stream": False
                }
                api_endpoint = f"{url}/api/chat"
                self._log_debug("🖼️ 使用多模态Chat API", debug_mode)
            else:
                # 对于纯文本模型，使用传统的generate API
                payload = {
                    "model": model,
                    "prompt": user_prompt,
                    "system": system_prompt,
                    "options": options,
                    "keep_alive": f"{keep_alive}m"
                }
                api_endpoint = f"{url}/api/generate"
                self._log_debug("📝 使用纯文本Generate API", debug_mode)
            
            # 发送请求到Ollama HTTP API
            print(f"Sending request to Ollama API: {api_endpoint}")
            print(f"Using model: {model}")
            if "1.7b" in model.lower() or "1.5b" in model.lower():
                print("Note: Small models may take longer to process complex prompts...")
            else:
                print("Note: This may take a while for complex prompts...")
            
            try:
                response = requests.post(
                    api_endpoint,
                    json=payload,
                    timeout=300  # 增加超时时间到5分钟
                )
            except requests.exceptions.Timeout:
                print("Request timed out. Trying with a shorter, simplified prompt...")
                # 尝试使用简化的prompt重新生成
                return self._generate_with_simplified_prompt(url, model, system_prompt, user_prompt, options, api_endpoint, debug_mode)
            
            print(f"Ollama API response status: {response.status_code}")
            if response.status_code == 200:
                # 先检查响应内容
                response_text = response.text
                print(f"Raw response length: {len(response_text)}")
                print(f"Response preview: {response_text[:200]}...")
                
                try:
                    # 处理可能的流式响应
                    if '\n' in response_text:
                        # 可能是NDJSON格式（每行一个JSON对象）
                        lines = response_text.strip().split('\n')
                        print(f"Found {len(lines)} lines in response")
                        
                        # 对于NDJSON流式响应，需要收集所有chunks的内容
                        collected_response = ""
                        final_result = None
                        
                        for line in lines:
                            line = line.strip()
                            if not line:
                                continue
                            
                            try:
                                chunk = json.loads(line)
                                
                                # 收集response内容
                                if 'response' in chunk and chunk['response']:
                                    collected_response += chunk['response']
                                
                                # 保存最后一个有效的结果对象（用于获取元数据）
                                if chunk:
                                    final_result = chunk
                                    
                            except json.JSONDecodeError as e:
                                print(f"Warning: Failed to parse line: {line[:100]}... Error: {e}")
                                continue
                        
                        # 如果收集到了响应内容，创建完整的结果对象
                        if collected_response:
                            result = final_result or {}
                            result['response'] = collected_response
                            print(f"Successfully collected streamed response, total length: {len(collected_response)}")
                        else:
                            # 如果没有收集到内容，使用最后一个JSON对象
                            result = final_result
                            if not result:
                                print("Error: No valid JSON found in response lines")
                                return None
                    else:
                        # 单行JSON响应
                        result = json.loads(response_text)
                    
                    print(f"Parsed JSON successfully, result keys: {list(result.keys()) if result else 'None'}")
                    self._log_debug(f"🔍 Ollama API响应: {str(result)[:200]}...", debug_mode)
                except json.JSONDecodeError as e:
                    print(f"JSON parsing error: {e}")
                    print(f"Problematic response text: {response_text}")
                    return None
                
                generated_text = None
                
                # 处理不同的API响应格式
                if image_base64:
                    # Chat API响应格式
                    if result and 'message' in result and 'content' in result['message']:
                        generated_text = result['message']['content'].strip()
                        self._log_debug("🖼️ 解析Chat API响应成功", debug_mode)
                    else:
                        self._log_debug(f"❌ Chat API响应格式错误: {result}", debug_mode)
                        return None
                else:
                    # Generate API响应格式
                    if result and 'response' in result:
                        generated_text = result['response'].strip()
                        print(f"Generated text length: {len(generated_text)}")
                        self._log_debug("📝 解析Generate API响应成功", debug_mode)
                    else:
                        print(f"Error: Generate API response missing 'response' field. Available fields: {list(result.keys()) if result else 'None'}")
                        self._log_debug(f"❌ Generate API响应缺少'response'字段: {result}", debug_mode)
                        return None
                
                if generated_text:
                    # 过滤掉qwen3等模型的thinking内容
                    filtered_text = self._filter_thinking_content(generated_text, debug_mode)
                    
                    print(f"Success: Generated text original length: {len(generated_text)}, filtered length: {len(filtered_text)}")
                    self._log_debug(f"✅ Ollama生成成功，原始长度: {len(generated_text)}, 过滤后长度: {len(filtered_text)} 字符", debug_mode)
                    return filtered_text
                else:
                    print("Error: Generated text is empty after parsing")
                    return None
            else:
                error_msg = f"Ollama API request failed - Status: {response.status_code}, Response: {response.text[:200]}"
                print(f"Error: {error_msg}")
                self._log_debug(f"❌ {error_msg}", debug_mode)
                return None
                
        except Exception as e:
            error_msg = f"Ollama generation exception: {str(e)}"
            print(f"Error: {error_msg}")
            self._log_debug(f"❌ {error_msg}", debug_mode)
            return None
    
    def _generate_with_simplified_prompt(self, url: str, model: str, system_prompt: str, 
                                       user_prompt: str, options: dict, api_endpoint: str, 
                                       debug_mode: bool) -> Optional[str]:
        """使用简化的prompt重新尝试生成"""
        try:
            import requests
            
            # 简化system prompt
            simplified_system = "You are an AI assistant that creates image editing instructions. Be concise and direct."
            
            # 简化user prompt - 只保留核心内容
            user_lines = user_prompt.split('\n')
            simplified_user = '\n'.join(user_lines[:10])  # 只保留前10行
            if len(user_lines) > 10:
                simplified_user += "\n[Content truncated for faster processing]"
            
            print("Trying with simplified prompt due to timeout...")
            
            # 构建简化的payload
            if "chat" in api_endpoint:
                payload = {
                    "model": model,
                    "messages": [
                        {"role": "system", "content": simplified_system},
                        {"role": "user", "content": simplified_user}
                    ],
                    "options": options,
                    "keep_alive": "5m"
                }
            else:
                payload = {
                    "model": model,
                    "prompt": simplified_user,
                    "system": simplified_system,
                    "options": options,
                    "keep_alive": "5m"
                }
            
            # 使用更短的超时时间
            response = requests.post(api_endpoint, json=payload, timeout=60)
            
            if response.status_code == 200:
                result = response.json()
                
                # 处理响应
                if "chat" in api_endpoint:
                    if result and 'message' in result and 'content' in result['message']:
                        generated_text = result['message']['content'].strip()
                    else:
                        return None
                else:
                    if result and 'response' in result:
                        generated_text = result['response'].strip()
                    else:
                        return None
                
                if generated_text:
                    filtered_text = self._filter_thinking_content(generated_text, debug_mode)
                    print("Simplified prompt generation successful")
                    return filtered_text
                
            return None
            
        except Exception as e:
            print(f"Simplified prompt generation also failed: {e}")
            return None
    
    def _filter_thinking_content(self, text: str, debug_mode: bool) -> str:
        """过滤掉模型的thinking内容 (如qwen3的<think>标签)"""
        try:
            import re
            
            # 过滤常见的thinking标签格式
            thinking_patterns = [
                r'<think>.*?</think>',  # qwen3的<think>标签
                r'<thinking>.*?</thinking>',  # 其他可能的thinking标签
                r'<thought>.*?</thought>',  # thought标签
                r'思考[:：].*?(?=\n|$)',  # 中文"思考:"开头的行
                r'Let me think.*?(?=\n|$)',  # 英文thinking开头
                r'I need to think.*?(?=\n|$)',  # 其他thinking表达
            ]
            
            filtered_text = text
            original_length = len(text)
            
            # 应用所有过滤规则
            for pattern in thinking_patterns:
                filtered_text = re.sub(pattern, '', filtered_text, flags=re.DOTALL | re.IGNORECASE)
            
            # 清理多余的空白字符
            filtered_text = re.sub(r'\n\s*\n\s*\n', '\n\n', filtered_text)  # 多个空行变成两个
            filtered_text = filtered_text.strip()
            
            # 如果过滤掉了内容，记录日志
            if len(filtered_text) < original_length:
                self._log_debug(f"🧹 过滤掉thinking内容，减少了 {original_length - len(filtered_text)} 字符", debug_mode)
            
            return filtered_text
            
        except Exception as e:
            self._log_debug(f"⚠️ thinking内容过滤失败: {e}，返回原始内容", debug_mode)
            return text
    
    def _format_flux_instructions(self, instructions: str, output_format: str, debug_mode: bool) -> str:
        """格式化Flux指令"""
        try:
            if output_format == "flux_kontext_standard":
                # 如果已经是标准格式，直接返回
                if "[EDIT_OPERATIONS]" in instructions:
                    return instructions
                else:
                    # 转换为标准格式
                    formatted = f"""[EDIT_OPERATIONS]
operation_1: {instructions}

[SPATIAL_CONSTRAINTS]
preserve_regions: ["original_composition"]
blend_boundaries: "seamless"

[QUALITY_CONTROLS]
detail_level: "high"
consistency: "maintain_original_quality"
realism: "photorealistic"
"""
                    return formatted
            elif output_format == "structured_json":
                # 转换为JSON格式
                try:
                    json_output = {
                        "operations": [{"description": instructions}],
                        "constraints": ["preserve_original_composition"],
                        "quality": {"detail_level": "high", "consistency": "high"}
                    }
                    return json.dumps(json_output, indent=2, ensure_ascii=False)
                except:
                    return instructions
            else:
                # 其他格式直接返回
                return instructions
                
        except Exception as e:
            self._log_debug(f"⚠️ 格式化失败，返回原始内容: {e}", debug_mode)
            return instructions
    
    def _generate_spatial_mappings(self, annotations: List[Dict], debug_mode: bool, include_numbers: bool = True) -> str:
        """生成空间映射信息"""
        try:
            mappings = {
                "regions": [],
                "coordinate_system": "absolute_pixels",
                "total_annotations": len(annotations)
            }
            
            for i, annotation in enumerate(annotations):
                region = {
                    "id": annotation.get("id", f"annotation_{i+1}"),
                    "type": annotation.get("type", "unknown"),
                    "color_code": annotation.get("color", "#000000")
                }
                
                # 只在需要时包含编号
                if include_numbers:
                    region["number"] = annotation.get("number", i+1)
                
                # 添加坐标信息
                if 'start' in annotation and 'end' in annotation:
                    start = annotation['start']
                    end = annotation['end']
                    region["coordinates"] = [
                        start.get('x', 0), start.get('y', 0),
                        end.get('x', 0), end.get('y', 0)
                    ]
                elif 'points' in annotation:
                    region["points"] = annotation['points']
                
                mappings["regions"].append(region)
            
            return json.dumps(mappings, indent=2, ensure_ascii=False)
            
        except Exception as e:
            self._log_debug(f"⚠️ 空间映射生成失败: {e}", debug_mode)
            return f'{{"error": "Failed to generate spatial mappings: {str(e)}"}}'
    
    def _generate_processing_metadata(self, model: str, strategy: str, 
                                    annotation_count: int, debug_mode: bool) -> str:
        """生成处理元数据"""
        try:
            processing_time = time.time() - self.start_time if self.start_time else 0
            
            metadata = {
                "processing_time": f"{processing_time:.2f}s",
                "timestamp": datetime.now().isoformat(),
                "ollama_model_used": model,
                "edit_strategy": strategy,
                "annotations_processed": annotation_count,
                "enhancement_applied": True,
                "status": "success"
            }
            
            if debug_mode and self.debug_logs:
                metadata["debug_logs"] = self.debug_logs
            
            return json.dumps(metadata, indent=2, ensure_ascii=False)
            
        except Exception as e:
            return f'{{"error": "Failed to generate metadata: {str(e)}"}}'
    
    def _log_debug(self, message: str, debug_mode: bool):
        """记录调试信息"""
        if debug_mode:
            timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
            log_message = f"[{timestamp}] {message}"
            self.debug_logs.append(log_message)
            print(log_message)  # 同时输出到控制台
    
    def _create_fallback_output(self, error_msg: str, debug_mode: bool) -> Tuple[str, str]:
        """创建失败时的回退输出"""
        self._log_debug(f"❌ 创建回退输出: {error_msg}", debug_mode)
        
        fallback_instructions = f"""[EDIT_OPERATIONS]
operation_1: Apply standard edit to marked regions
# Error: {error_msg}

[SPATIAL_CONSTRAINTS]
preserve_regions: ["all_unmarked_areas"]
blend_boundaries: "seamless"

[QUALITY_CONTROLS]
detail_level: "standard"
consistency: "maintain_original"
"""
        
        fallback_system_prompt = f"Error occurred during processing: {error_msg}"
        
        return (fallback_instructions, fallback_system_prompt)


# 添加API端点用于动态获取模型
if WEB_AVAILABLE:
    @PromptServer.instance.routes.post("/ollama_flux_enhancer/get_models")
    async def get_models_endpoint(request):
        """获取可用的Ollama模型列表 - 云端环境兼容版本"""
        try:
            data = await request.json()
            url = data.get("url", "http://127.0.0.1:11434")
            
            print(f"🔄 API端点: 开始获取Ollama模型列表")
            print(f"📡 API端点: 请求URL: {url}")
            print(f"🌐 API端点: 客户端来源: {request.remote}")
            
            # 云端环境特殊处理：如果是localhost，可能需要不同的地址
            if "127.0.0.1" in url or "localhost" in url:
                print("⚠️ API端点: 检测到localhost地址，在云端环境中可能无法访问")
                print("💡 API端点: 建议检查Ollama服务配置和网络连接")
            
            # 使用与主节点完全相同的模型检测逻辑
            print("🔍 API端点: 调用 get_available_models 方法")
            model_names = OllamaFluxKontextEnhancerV2.get_available_models(url=url, force_refresh=True)
            
            print(f"✅ API端点: 检测完成，获取到 {len(model_names)} 个模型")
            if model_names:
                print(f"📋 API端点: 模型列表: {model_names}")
            else:
                print("❌ API端点: 未检测到任何模型")
                print("🔧 API端点: 可能的原因:")
                print("   1. Ollama服务未运行")
                print("   2. 网络连接问题（云端环境常见）")
                print("   3. URL配置错误")
                print("   4. 防火墙阻塞")
            
            return web.json_response(model_names)
            
        except Exception as e:
            print(f"❌ API端点严重错误: {e}")
            import traceback
            error_details = traceback.format_exc()
            print(f"🔍 API端点错误详情:\n{error_details}")
            
            # 返回错误信息给前端
            return web.json_response({
                "error": str(e),
                "details": error_details,
                "models": []
            }, status=500)


# 节点注册
NODE_CLASS_MAPPINGS = {
    "OllamaFluxKontextEnhancerV2": OllamaFluxKontextEnhancerV2,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "OllamaFluxKontextEnhancerV2": "🤖 Ollama Flux Kontext Enhancer V2",
}