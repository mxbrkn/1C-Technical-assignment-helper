"""
Помощник формулировки ТЗ - FastAPI Backend
Проксирует запросы к DeepSeek / Claude API, скрывая токены от клиента.
"""

import os
import logging
from typing import Literal

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

# --- Конфигурация -----------------------------------------------------------

load_dotenv()

# DeepSeek
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_API_URL = os.getenv("DEEPSEEK_API_URL", "https://api.deepseek.com/chat/completions")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
DEEPSEEK_MAX_TOKENS = int(os.getenv("DEEPSEEK_MAX_TOKENS", "2000"))
DEEPSEEK_TEMPERATURE = float(os.getenv("DEEPSEEK_TEMPERATURE", "0.7"))

# Claude (Anthropic)
CLAUDE_API_KEY = os.getenv("CLAUDE_API_KEY", "")
CLAUDE_API_URL = os.getenv("CLAUDE_API_URL", "https://api.anthropic.com/v1/messages")
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-20250514")
CLAUDE_MAX_TOKENS = int(os.getenv("CLAUDE_MAX_TOKENS", "2000"))

ANTHROPIC_VERSION = "2023-06-01"

if not DEEPSEEK_API_KEY:
    logging.warning("DEEPSEEK_API_KEY не задан! Проверьте файл .env")
if not CLAUDE_API_KEY:
    logging.warning("CLAUDE_API_KEY не задан! Проверьте файл .env")

# --- FastAPI App -------------------------------------------------------------

app = FastAPI(title="Помощник ТЗ", docs_url=None, redoc_url=None)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Pydantic Models ---------------------------------------------------------

Provider = Literal["deepseek", "claude"]


class GenerateQuestionsRequest(BaseModel):
    task_description: str
    existing_questions: list[str] = []
    mode: str = "simplified"
    provider: Provider = "deepseek"


class RefreshQuestionRequest(BaseModel):
    question: str
    provider: Provider = "deepseek"


class GenerateTZRequest(BaseModel):
    task_description: str
    provider: Provider = "deepseek"


class ChatResponse(BaseModel):
    content: str


# --- LLM API Helpers ---------------------------------------------------------


async def call_deepseek(system_prompt: str, user_prompt: str) -> str:
    """Отправляет запрос к DeepSeek API (OpenAI-совместимый формат)."""
    if not DEEPSEEK_API_KEY:
        raise HTTPException(status_code=500, detail="DeepSeek API ключ не настроен на сервере")

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
    }

    payload = {
        "model": DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "max_tokens": DEEPSEEK_MAX_TOKENS,
        "temperature": DEEPSEEK_TEMPERATURE,
        "stream": False,
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(DEEPSEEK_API_URL, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"]
        except httpx.HTTPStatusError as exc:
            logger.error("DeepSeek HTTP error: %s — %s", exc.response.status_code, exc.response.text)
            raise HTTPException(status_code=502, detail=f"DeepSeek API ошибка: {exc.response.status_code}")
        except httpx.RequestError as exc:
            logger.error("DeepSeek request error: %s", exc)
            raise HTTPException(status_code=502, detail="Ошибка соединения с DeepSeek API")
        except (KeyError, IndexError) as exc:
            logger.error("Unexpected DeepSeek response: %s", exc)
            raise HTTPException(status_code=502, detail="Некорректный ответ от DeepSeek API")


async def call_claude(system_prompt: str, user_prompt: str) -> str:
    """Отправляет запрос к Claude (Anthropic Messages API)."""
    if not CLAUDE_API_KEY:
        raise HTTPException(status_code=500, detail="Claude API ключ не настроен на сервере")

    headers = {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
    }

    payload = {
        "model": CLAUDE_MODEL,
        "max_tokens": CLAUDE_MAX_TOKENS,
        "system": system_prompt,
        "messages": [
            {"role": "user", "content": user_prompt},
        ],
    }

    async with httpx.AsyncClient(timeout=90.0) as client:
        try:
            response = await client.post(CLAUDE_API_URL, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            # Anthropic возвращает content как массив блоков
            return data["content"][0]["text"]
        except httpx.HTTPStatusError as exc:
            logger.error("Claude HTTP error: %s — %s", exc.response.status_code, exc.response.text)
            raise HTTPException(status_code=502, detail=f"Claude API ошибка: {exc.response.status_code}")
        except httpx.RequestError as exc:
            logger.error("Claude request error: %s", exc)
            raise HTTPException(status_code=502, detail="Ошибка соединения с Claude API")
        except (KeyError, IndexError) as exc:
            logger.error("Unexpected Claude response: %s", exc)
            raise HTTPException(status_code=502, detail="Некорректный ответ от Claude API")


async def call_llm(provider: Provider, system_prompt: str, user_prompt: str) -> str:
    """Роутер: вызывает нужный LLM-провайдер."""
    if provider == "claude":
        return await call_claude(system_prompt, user_prompt)
    return await call_deepseek(system_prompt, user_prompt)


# --- API Endpoints -----------------------------------------------------------

SYSTEM_PROMPT = (
    "Ты опытный аналитик 1С, помогающий формулировать технические задания. "
    "Отвечай только по существу, без лишних комментариев. "
    "Генерируй только запрошенный контент."
)


@app.post("/api/generate-questions", response_model=ChatResponse)
async def generate_questions(req: GenerateQuestionsRequest):
    """Генерирует уточняющие вопросы для задачи."""
    max_q = 5 if req.mode == "simplified" else 15
    remaining = max_q - len(req.existing_questions)

    if remaining <= 0:
        raise HTTPException(
            status_code=400,
            detail=f"Достигнут лимит вопросов ({max_q}) для режима «{req.mode}»",
        )

    existing = ", ".join(req.existing_questions) if req.existing_questions else "нет"

    prompt = f"""Как опытный аналитик 1С, сформулируй {remaining} уточняющих вопросов для следующей задачи.

Задача: "{req.task_description}"

Существующие вопросы: {existing}

Требования:
- Только вопросы, заканчивающиеся вопросительным знаком
- Вопросы должны быть конкретными и полезными для составления ТЗ
- Каждый вопрос с новой строки
- Не добавляй пояснения или дополнительный текст
- Вопросы должны быть про 1С и технические детали"""

    content = await call_llm(req.provider, SYSTEM_PROMPT, prompt)
    return ChatResponse(content=content)


@app.post("/api/refresh-question", response_model=ChatResponse)
async def refresh_question(req: RefreshQuestionRequest):
    """Переформулирует вопрос проще и понятнее."""
    prompt = (
        f'Переформулируй следующий вопрос проще и понятнее: "{req.question}". '
        "Верни только переформулированный вопрос, без дополнительного текста."
    )
    content = await call_llm(req.provider, SYSTEM_PROMPT, prompt)
    return ChatResponse(content=content)


@app.post("/api/generate-tz", response_model=ChatResponse)
async def generate_tz(req: GenerateTZRequest):
    """Генерирует техническое задание по собранной информации."""
    prompt = f"""На основе следующей информации составь понятное и читабельное техническое задание для программиста 1С:

ИСХОДНАЯ ЗАДАЧА:
{req.task_description}

Требования к ТЗ:
- Понятная структура с заголовками разных уровней
- Конкретные технические требования
- Критерии приемки
- Технические детали для реализации в 1С
- Формат, понятный программисту
- Учитывай особенности платформы 1С:Предприятие

ВАЖНО: Верни ТЗ СТРОГО в формате Markdown:
- Используй заголовки: # Заголовок 1, ## Заголовок 2, ### Заголовок 3
- Для выделения используй **жирный текст**
- Для списков используй - или *
- Для кода используй `код` или ```блок кода```
- НЕ используй HTML теги
- НЕ добавляй лишнее форматирование"""

    content = await call_llm(req.provider, SYSTEM_PROMPT, prompt)
    return ChatResponse(content=content)


@app.get("/api/health")
async def health_check():
    """Проверка работоспособности сервера."""
    return {
        "status": "ok",
        "providers": {
            "deepseek": bool(DEEPSEEK_API_KEY),
            "claude": bool(CLAUDE_API_KEY),
        },
    }


# --- Static Files & SPA Fallback --------------------------------------------

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def serve_index():
    return FileResponse("static/index.html")


# --- Run ---------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("app:app", host=host, port=port, reload=True)
