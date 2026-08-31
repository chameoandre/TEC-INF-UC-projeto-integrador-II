#!/usr/bin/env python3
"""
Script de sincronização automatizada dos dados da Planilha Oficial de PI-II (IFSC).
Baixa a planilha em formato CSV, faz o parsing, audita links do Overleaf e atualiza o HTML.
"""

import csv
import json
import re
import urllib.request
from datetime import datetime

SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1w7wAwPBdNTfh7lvynoP7x35S__lvRyuTjRqP26oEhNQ/export?format=csv"
HTML_FILES = [
    "2026-2/dashboard-pi2-2026.html",
    "2026-2/index.html"
]

def fetch_csv_data():
    print(f"[*] Baixando dados da planilha do Google Sheets...")
    req = urllib.request.Request(
        SHEET_CSV_URL,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    )
    with urllib.request.urlopen(req) as response:
        content = response.read().decode('utf-8')
    return content

def parse_projects(csv_text):
    print("[*] Processando linhas e colunas...")
    reader = csv.reader(csv_text.splitlines())
    rows = list(reader)
    
    projects = []
    
    # Percorrer linhas procurando IDs de 1 a 10
    for row in rows:
        if not row or len(row) < 5:
            continue
        first_col = row[0].strip()
        if first_col.isdigit():
            proj_id = int(first_col)
            if 1 <= proj_id <= 10:
                title = row[1].strip() if len(row) > 1 else ""
                team = row[2].strip() if len(row) > 2 else ""
                objective = row[3].strip() if len(row) > 3 else ""
                github = row[4].strip() if len(row) > 4 else ""
                
                # Check Overleaf URL (pode estar na coluna 5 ou dentro do Paper na coluna 12)
                overleaf_col = row[5].strip() if len(row) > 5 else ""
                paper_col = row[12].strip() if len(row) > 12 else ""
                
                overleaf_url = ""
                if "overleaf.com" in overleaf_col:
                    m = re.search(r'(https?://[^\s,"]*overleaf\.com[^\s,"]*)', overleaf_col)
                    if m:
                        overleaf_url = m.group(1)
                elif "overleaf.com" in paper_col:
                    m = re.search(r'(https?://[^\s,"]*overleaf\.com[^\s,"]*)', paper_col)
                    if m:
                        overleaf_url = m.group(1)
                
                # Auditoria de status do Overleaf
                if not overleaf_url:
                    overleaf_status = "pendente"
                elif "/project/" in overleaf_url:
                    overleaf_status = "privado"
                else:
                    overleaf_status = "ok"

                canva = row[6].strip() if len(row) > 6 else ""
                if canva.upper() == "PENDENTE":
                    canva = ""

                pitch = row[7].strip() if len(row) > 7 else ""
                if pitch.upper() == "PENDENTE":
                    pitch = ""

                exp1 = row[8].strip() if len(row) > 8 else "Pendente"
                exp2 = row[9].strip() if len(row) > 9 else "Pendente"
                exp3 = row[10].strip() if len(row) > 10 else "Pendente"
                exp4 = row[11].strip() if len(row) > 11 else "Pendente"

                advances = row[16].strip() if len(row) > 16 else ""
                next_steps = row[17].strip() if len(row) > 17 else ""
                difficulties = row[18].strip() if len(row) > 18 else ""
                techs_raw = row[19].strip() if len(row) > 19 else ""
                observations = row[20].strip() if len(row) > 20 else ""

                # Extrair tecnologias como lista limpa
                tech_list = []
                if techs_raw:
                    split_techs = re.split(r'[,\n;]+', techs_raw)
                    tech_list = [t.strip() for t in split_techs if t.strip()]
                if not tech_list:
                    tech_list = ["Documentação", "Pesquisa"]

                projects.append({
                    "id": proj_id,
                    "title": title,
                    "team": team,
                    "objective": objective,
                    "github": github,
                    "overleaf": overleaf_url,
                    "overleafStatus": overleaf_status,
                    "canva": canva,
                    "pitch": pitch,
                    "techs": tech_list,
                    "advances": advances,
                    "nextSteps": next_steps,
                    "difficulties": difficulties,
                    "observations": observations,
                    "experiments": {
                        "exp1": exp1 if exp1 else "Pendente",
                        "exp2": exp2 if exp2 else "Pendente",
                        "exp3": exp3 if exp3 else "Pendente",
                        "exp4": exp4 if exp4 else "Pendente"
                    },
                    "paperStatus": paper_col.replace("\n", " ").strip() if paper_col else "Planejamento"
                })

    print(f"[+] Total de projetos extraídos: {len(projects)}")
    return projects

def update_html_files(projects):
    json_data = json.dumps(projects, ensure_ascii=False, indent=2)
    timestamp = datetime.now().strftime("%d/%m/%Y às %H:%M")

    for file_path in HTML_FILES:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()

            # Substituir array projectsData
            pattern = r"const projectsData = \[[\s\S]*?\];"
            replacement = f"const projectsData = {json_data};"
            
            if re.search(pattern, content):
                new_content = re.sub(pattern, replacement, content)
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(new_content)
                print(f"[✓] Arquivo {file_path} atualizado com sucesso!")
            else:
                print(f"[!] Marcador 'const projectsData' não encontrado em {file_path}")
        except Exception as e:
            print(f"[X] Erro ao atualizar {file_path}: {e}")

if __name__ == "__main__":
    csv_raw = fetch_csv_data()
    projects = parse_projects(csv_raw)
    update_html_files(projects)
    print("\n[🎉] Sincronização concluída com sucesso!")
