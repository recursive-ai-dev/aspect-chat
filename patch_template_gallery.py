import re

with open("src/js/modules/aspects.js", "r") as f:
    content = f.read()

search_pattern = """            aspectTemplates.forEach(template => {
                const card = document.createElement('div');
                card.className = 'template-card';
                card.innerHTML = `
                    <h3>${template.name}</h3>
                    <p>${template.desc}</p>
                `;
                card.onclick = () => acceptCreateAspectFromTemplate(template.id);
                gallery.appendChild(card);
            });"""

replace_pattern = """            aspectTemplates.forEach(template => {
                const card = document.createElement('div');
                card.className = 'template-card';

                const h3 = document.createElement('h3');
                h3.textContent = template.name;
                card.appendChild(h3);

                const p = document.createElement('p');
                p.textContent = template.desc;
                card.appendChild(p);

                card.onclick = () => acceptCreateAspectFromTemplate(template.id);
                gallery.appendChild(card);
            });"""

if search_pattern in content:
    content = content.replace(search_pattern, replace_pattern)
    with open("src/js/modules/aspects.js", "w") as f:
        f.write(content)
    print("Successfully patched template gallery")
else:
    print("Failed to find template gallery code to patch")
