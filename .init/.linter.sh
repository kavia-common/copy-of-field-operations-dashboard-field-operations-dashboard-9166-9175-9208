#!/bin/bash
cd /home/kavia/workspace/code-generation/field-operations-dashboard-9166-9175/dashboard_frontend
npm run build
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
   exit 1
fi

