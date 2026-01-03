#!/bin/bash

echo "🔨 Building Chess Engine..."
npm run build

echo "🚀 Starting Django Development Server..."
echo "Half Blind Chess will be available at: http://localhost:8000/half-blind-chess/"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

python manage.py runserver