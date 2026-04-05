#!/bin/bash
echo ""
echo " Installing dependencies..."
pip3 install flask --quiet
echo ""
echo " Starting Grabbit..."
sleep 2 && open http://localhost:5000 2>/dev/null || xdg-open http://localhost:5000 2>/dev/null &
echo ""
python3 app.py