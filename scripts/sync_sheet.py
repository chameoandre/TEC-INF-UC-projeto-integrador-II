#!/usr/bin/env python3
"""
Grava no HTML do dashboard uma cópia dos dados da planilha de PI-II (IFSC).

A cópia serve de reserva: o dashboard busca os dados ao vivo (pi2-live.js) e só
recorre a ela quando a leitura ao vivo falha. A conversão linha -> projeto segue
a mesma regra de linhasParaProjetos() em 2026-2/pi2-live.js e apps-script/Code.gs.
"""

import csv
import io
import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1w7wAwPBdNTfh7lvynoP7x35S__lvRyuTjRqP26oEhNQ/export?format=csv"
HTML_FILES = ["2026-2/index.html"]

# Projeto acompanhado fora da planilha. Não incluir aqui dados de saúde do estudante: a página é pública.
PROJETO_INDIVIDUAL = {
    "id": 11,
    "title": "Plano de Atendimento Domiciliar — Artigo Científico Individual",
    "team": "Joel Jorge Teixeira Filho",
    "objective": "Desenvolvimento individual de pesquisa e redação de artigo científico no formato SBC adaptado para atendimento pedagógico domiciliar.",
    "github": "",
    "relatorio": "",
    "overleaf": "",
    "overleafStatus": "pendente",
    "canva": "https://drive.google.com/drive/folders/1mSPjqJ0mF2bXyLc2lwCU3AdrASHG8Vm5",
    "pitch": "",
    "relatedWorks": "M1 (Até 15/10): Mapeamento de 4 Trabalhos Relacionados no Google Scholar / SBC Open Lib",
    "techs": ["Atendimento Domiciliar", "Pesquisa Científica", "LaTeX / SBC"],
    "advances": "Dossiê pedagógico estruturado (26/09). Carta de orientações e cronograma de 4 marcos elaborados pelos docentes André e Nauber.",
    "nextSteps": "Marco M1: Definição do tema e busca dos 4 trabalhos relacionados. Envio do link do Overleaf individual.",
    "difficulties": "Acompanhamento assíncrono à distância.",
    "observations": "Pasta compartilhada com Coordenação e CP ativa no Google Drive. Semestre de conclusão de curso 2026-2.",
    "experiments": {
        "exp1": "Marco M1 (15/10): Tema & 4 Trabalhos Relacionados",
        "exp2": "Marco M2 (31/10): Introdução & Metodologia de Pesquisa",
        "exp3": "Marco M3 (20/11): Experimentos/Simulações & Discussão",
        "exp4": "Marco M4 (05/12): Artigo Completo Finalizado (Formato SBC)",
    },
    "experimentResults": {"exp1": "Planejado", "exp2": "Planejado", "exp3": "Planejado", "exp4": "Planejado"},
    "paperStatus": "Em estruturação (Overleaf individual)",
    "cotbStatus": "Pendente",
    "isDomiciliar": True,
}

# Painéis próprios de alguns projetos.
DASHBOARDS = {7: "https://chameoandre.github.io/Luisa-s-COTB-Python-Game-notes-Project/"}


def fetch_csv_data():
    print("[*] Baixando a planilha em CSV...")
    req = urllib.request.Request(SHEET_CSV_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as response:
        return response.read().decode("utf-8")


def cell(row, i):
    return row[i].replace("\r\n", "\n").replace("\r", "\n").strip() if len(row) > i else ""


def is_pending(value):
    return not value or value.upper() == "PENDENTE"


def parse_projects(csv_text):
    # io.StringIO (e não splitlines) preserva as quebras de linha dentro das células.
    rows = list(csv.reader(io.StringIO(csv_text, newline="")))
    projects = []

    for row in rows:
        first = cell(row, 0)
        if not first.isdigit():
            continue
        proj_id = int(first)
        if not 1 <= proj_id <= 99 or not cell(row, 1):
            continue

        relatorio, paper1, paper4 = cell(row, 5), cell(row, 17), cell(row, 20)
        overleaf = ""
        for candidate in (relatorio, paper4, paper1):
            m = re.search(r'https?://[^\s,"]*overleaf\.com[^\s,"]*', candidate)
            if m:
                overleaf = m.group(0)
                break
        if not overleaf:
            overleaf_status = "pendente"
        elif "/project/" in overleaf:
            overleaf_status = "privado"
        else:
            overleaf_status = "ok"

        techs_raw = cell(row, 24)
        techs = [t.strip().rstrip(".") for t in re.split(r"[,;\n]+", techs_raw) if t.strip()]

        entry = {
            "id": proj_id,
            "title": cell(row, 1),
            "team": cell(row, 2),
            "objective": cell(row, 3),
            "github": cell(row, 4),
            "relatorio": relatorio,
            "overleaf": overleaf,
            "overleafStatus": overleaf_status,
            "canva": "" if is_pending(cell(row, 6)) else cell(row, 6),
            "pitch": "" if is_pending(cell(row, 7)) else cell(row, 7),
            "relatedWorks": cell(row, 8) or "PENDENTE",
            "techs": techs or ["A definir"],
            "techsRaw": techs_raw,
            "advances": cell(row, 21),
            "nextSteps": cell(row, 22),
            "difficulties": cell(row, 23),
            "observations": cell(row, 25),
            "experiments": {f"exp{n}": cell(row, 7 + 2 * n) or "PENDENTE" for n in (1, 2, 3, 4)},
            "experimentResults": {f"exp{n}": cell(row, 8 + 2 * n) for n in (1, 2, 3, 4)},
            "papers": {"paper1": paper1, "paper2": cell(row, 18), "paper3": cell(row, 19), "paper4": paper4},
            "paperStatus": paper1 or "Planejamento",
            "cotbStatus": paper4 or "Pendente",
        }
        if proj_id in DASHBOARDS:
            entry["dashboard"] = DASHBOARDS[proj_id]
        projects.append(entry)

    if not any(p["id"] == PROJETO_INDIVIDUAL["id"] for p in projects):
        projects.append(PROJETO_INDIVIDUAL)

    print(f"[+] Projetos extraídos: {len(projects)}")
    return projects


def update_html_files(projects):
    # "</" é neutralizado para que nenhum texto da planilha consiga fechar a tag <script>.
    json_data = json.dumps(projects, ensure_ascii=False, indent=2).replace("</", "<\\/")
    agora = datetime.now(timezone(timedelta(hours=-3))).strftime("%d/%m/%Y às %H:%M")
    ok = True

    for file_path in HTML_FILES:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()

        pattern = r"const projectsData = \[[\s\S]*?\n\];"
        if not re.search(pattern, content):
            print(f"[!] Marcador 'const projectsData' não encontrado em {file_path}")
            ok = False
            continue
        # Função como substituto: o texto dos projetos não é interpretado como padrão de regex.
        content = re.sub(pattern, lambda _: f"const projectsData = {json_data};", content, count=1)
        content = re.sub(r'window\.PI2_BAKED_AT = "[^"]*";', f'window.PI2_BAKED_AT = "{agora}";', content, count=1)

        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"[✓] {file_path} atualizado")
    return ok


if __name__ == "__main__":
    projetos = parse_projects(fetch_csv_data())
    if len(projetos) < 2:
        sys.exit("[X] A planilha voltou sem projetos; o HTML não foi alterado.")
    if not update_html_files(projetos):
        sys.exit(1)
    print("[🎉] Sincronização concluída")
