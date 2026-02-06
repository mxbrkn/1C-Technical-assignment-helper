# Помощник формулировки ТЗ для 1С

Веб-приложение для формирования технических заданий для программистов 1С с помощью DeepSeek AI.

## Архитектура

```
Браузер  ──►  Nginx (порт 80)  ──►  FastAPI / Uvicorn (порт 8000)  ──►  DeepSeek API
                  │
                  └── /static/ отдаётся напрямую
```

- **Backend:** Python 3.11+ / FastAPI / Uvicorn
- **Frontend:** Vanilla JS (без фреймворков)
- **Reverse Proxy:** Nginx
- **Деплой:** Systemd сервис на Linux Debian

## Структура проекта

```
├── app.py               # FastAPI-бекенд
├── requirements.txt     # Python-зависимости
├── .env                 # Конфигурация (API-ключи) — НЕ коммитить!
├── .env.example         # Шаблон конфигурации
├── static/
│   ├── index.html       # Главная страница
│   ├── script.js        # Клиентская логика
│   └── style.css        # Стили
├── nginx/
│   └── tz-helper.conf   # Конфиг Nginx
├── tz-helper.service    # Systemd-юнит
└── README.md
```

## Быстрый запуск (для разработки)

```bash
# 1. Установить зависимости
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 2. Настроить .env
cp .env.example .env
nano .env   # ← вставить свой DEEPSEEK_API_KEY

# 3. Запустить
python app.py
# Открыть http://127.0.0.1:8000
```

## Деплой на Debian (production)

### 1. Установить зависимости ОС

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip nginx
```

### 2. Подготовить директорию

```bash
sudo mkdir -p /opt/tz-helper
sudo cp -r ./* /opt/tz-helper/
sudo chown -R www-data:www-data /opt/tz-helper
```

### 3. Создать виртуальное окружение

```bash
cd /opt/tz-helper
sudo -u www-data python3 -m venv venv
sudo -u www-data venv/bin/pip install -r requirements.txt
```

### 4. Настроить .env

```bash
sudo cp .env.example .env
sudo nano .env
# Установить DEEPSEEK_API_KEY
sudo chown www-data:www-data .env
sudo chmod 600 .env
```

### 5. Установить systemd-сервис

```bash
sudo cp tz-helper.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable tz-helper
sudo systemctl start tz-helper
sudo systemctl status tz-helper   # проверить
```

### 6. Настроить Nginx

```bash
sudo cp nginx/tz-helper.conf /etc/nginx/sites-available/tz-helper
sudo ln -s /etc/nginx/sites-available/tz-helper /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default   # убрать дефолтный сайт (опционально)
sudo nginx -t                                   # проверить конфиг
sudo systemctl reload nginx
```

### 7. Проверить

```bash
curl http://localhost
# Должен вернуть HTML страницу

curl http://localhost/api/health
# Должен вернуть {"status":"ok","api_configured":true}
```

## Обновление

```bash
cd /opt/tz-helper
sudo systemctl stop tz-helper
sudo -u www-data git pull            # или скопируйте файлы вручную
sudo -u www-data venv/bin/pip install -r requirements.txt
sudo systemctl start tz-helper
```

## Полезные команды

```bash
# Логи приложения
sudo journalctl -u tz-helper -f

# Логи Nginx
sudo tail -f /var/log/nginx/tz-helper-access.log
sudo tail -f /var/log/nginx/tz-helper-error.log

# Перезапуск
sudo systemctl restart tz-helper
sudo systemctl reload nginx
```
