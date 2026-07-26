import json
import requests

s = requests.Session()

r = s.post('https://gout-gueule-fcvr.onrender.com/api/auth/login',
    json={'email': 'admin@goutgueule.com', 'password': 'admin123'})
print('Login:', r.json())

articles = [
    {
        'title': 'Fufu Traditionnel',
        'content': "# Le Fufu Traditionnel de Kinshasa\n\nLe **fufu** est bien plus qu'un plat — c'est un rituel.\n\n## Ingrédients\n- Manioc frais (5 kg)\n- Eau chaude\n- Sel de cuisine\n\n## Préparation\n1. Peler et laver le manioc\n2. Cuire à l'eau bouillante pendant 45 minutes\n3. Piler au mortier jusqu'à obtenir une pâte lisse\n4. Servir chaud avec la sauce de votre choix\n\n## Notre conseil\nMangez avec les mains, c'est la tradition. Accompagnez de pondu ou de poisson grillé.",
        'tags': ['fufu', 'tradition', 'manioc', 'cuisine-congolaise'],
        'coverImage': 'https://images.unsplash.com/photo-1604329760661-e71dc83f8f26?w=800',
    },
    {
        'title': 'Pondu à la Moambe',
        'content': "# Le Pondu à la Moambe\n\nLe pondu (feuilles de manioc) sauce moambe est l'un des plats emblématiques de la RDC.\n\n## Ingrédients\n- Feuilles de manioc (1 kg)\n- Pâte de moambe (200g)\n- Poisson fumé\n- Huile de palme\n- Oignons, tomates, piment\n\n## Étapes\n1. Laver et couper les feuilles de pondu\n2. Faire revenir les oignons dans l'huile de palme\n3. Ajouter le poisson fumé émietté\n4. Incorporer le pondu et la moambe\n5. Mijoter 30 minutes\n\nServi avec fufu ou riz blanc.",
        'tags': ['pondu', 'moambe', 'manioc', 'poisson'],
        'coverImage': 'https://images.unsplash.com/photo-1574484284002-952d92456975?w=800',
    },
    {
        'title': 'Poisson Grillé du Fleuve',
        'content': "# Le Poisson Grillé du Fleuve Congo\n\nÀ Kinshasa, le **poisson grillé** se déguste partout — des bords du fleuve aux restaurants chics.\n\n## Les poissons stars\n- **Kapelete** (Tilapia du fleuve)\n- **Mambamba** (une variété locale)\n- **Ndakala** (petits poissons frits)\n\n## Marinade traditionnelle\n- Ail, gingembre, piment\n- Citron vert\n- Oignons verts\n- Persil frais\n\n## La cuisson\nGrillé au feu de bois pendant 15-20 minutes, servi avec **piment pilé** et **madesu** (haricots).\n\nLe tout se mange avec du pain ou des plantains frits (*mikenke*).",
        'tags': ['poisson', 'grillade', 'fleuve', 'kapelete'],
        'coverImage': 'https://images.unsplash.com/photo-1535399831218-d5bd36d1a6b3?w=800',
    }
]

for art in articles:
    r = s.post('https://gout-gueule-fcvr.onrender.com/api/admin/posts',
        data={
            'title': art['title'],
            'content': art['content'],
            'tags': json.dumps(art['tags']),
            'coverImage': art['coverImage'],
            'published': 'true'
        })
    if r.ok:
        print(f"  + {art['title']}: {r.json().get('id', '')[:8]}")
    else:
        print(f"  - {art['title']}: {r.status_code} {r.text[:100]}")

print()
r = s.get('https://gout-gueule-fcvr.onrender.com/api/posts')
posts = r.json()
print(f'Total posts: {len(posts)}')
for p in posts:
    print(f"  - {p['title']} (media: {len(p.get('media', []))})")
