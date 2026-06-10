import requests
import mysql.connector
import time

conexion = mysql.connector.connect(
    host="localhost",
    user="root",
    password="d:ct-&$v2MLzc@C",
    database="FutPicks_DB"
)

cursor = conexion.cursor(dictionary=True)

cursor.execute("""
SELECT
    team_id,
    team_name
FROM teams
WHERE logo_url IS NULL
""")

teams = cursor.fetchall()

# PRUEBA SOLO CON 20 EQUIPOS
teams = teams[:20]

print(f"\nEQUIPOS A PROCESAR: {len(teams)}\n")

for team in teams:

    team_id = team["team_id"]
    team_name = team["team_name"]

    try:

        print(f"BUSCANDO: {team_name}")

        search_response = requests.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "list": "search",
                "srsearch": team_name,
                "format": "json"
            },
            timeout=20
        )

        search_data = search_response.json()

        if not search_data["query"]["search"]:

            print("NO ENCONTRADO")
            continue

        page_title = search_data["query"]["search"][0]["title"]

        print("PAGINA:", page_title)

        image_response = requests.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "titles": page_title,
                "prop": "pageimages",
                "piprop": "original",
                "format": "json"
            },
            timeout=20
        )

        image_data = image_response.json()

        pages = image_data["query"]["pages"]

        image_url = None

        for page_id in pages:

            page = pages[page_id]

            if "original" in page:

                image_url = page["original"]["source"]
                break

        if image_url:

            cursor.execute(
                """
                UPDATE teams
                SET logo_url = %s
                WHERE team_id = %s
                """,
                (
                    image_url,
                    team_id
                )
            )

            conexion.commit()

            print("LOGO GUARDADO")

        else:

            print("SIN IMAGEN")

        time.sleep(1)

    except Exception as e:

        print(
            "ERROR:",
            team_name,
            str(e)
        )

cursor.close()
conexion.close()

print("\nPROCESO TERMINADO")