# AI Provider Configuration Guide

D4IDE operates entirely via **BYOK (Bring Your Own Key)**. All API requests originate directly from the user's desktop application to the configured API endpoints. No intermediate servers or key escrow are involved.

## Supported Providers

### 1. DeepSeek
- **Base URL**: `https://api.deepseek.com/v1`
- **Supported Models**:
  - `deepseek-chat` (DeepSeek V3) — High performance, cost-effective coding model.
  - `deepseek-reasoner` (DeepSeek R1) — Reasoning model capable of deep architectural thinking.
- **Tools**: Full tool calling and reasoning delta extraction supported.

### 2. OpenAI
- **Base URL**: `https://api.openai.com/v1`
- **Supported Models**: `gpt-4o`, `gpt-4o-mini`, `o3-mini`
- **Features**: Multi-modal vision, structured tool calling, reasoning parameters.

### 3. Google Gemini
- **Base URL**: `https://generativelanguage.googleapis.com/v1beta`
- **Supported Models**: `gemini-2.5-flash`, `gemini-2.5-pro`
- **Features**: Low-latency streaming, large context window, tool calling.

### 4. Anthropic Claude
- **Base URL**: `https://api.anthropic.com/v1`
- **Supported Models**: `claude-3-7-sonnet-20250219`, `claude-3-5-haiku-20241022`
- **Features**: Hybrid reasoning, tool calling, code generation excellence.

### 5. Ollama (Local Models)
- **Base URL**: `http://localhost:11434/v1`
- **Supported Models**: `qwen2.5-coder:7b`, `deepseek-r1:8b`
- **Features**: Runs 100% offline on your local GPU/CPU; no API key needed.

### 6. Custom OpenAI-Compatible Endpoints
Users can connect any custom OpenAI-compatible server (e.g. vLLM, LM Studio, Groq, Together AI, Mistral) by specifying:
- Provider Name
- Base URL
- API Key
- Model ID
