@echo off
title Grabbit
echo.
echo  Installing dependencies...
pip install flask --quiet
echo.
echo  Starting Grabbit...
start http://localhost:5000
echo.
python app.py
pause