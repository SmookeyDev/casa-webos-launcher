# Referências e direção visual

## Fontes primárias

- [Apple — Designing for tvOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-tvos/): interface à distância, foco claro e conteúdo legível.
- [Apple — Layout](https://developer.apple.com/design/human-interface-guidelines/layout): margens e espaço suficiente para o item em foco.
- [Apple — Focus and selection](https://developer.apple.com/design/human-interface-guidelines/focus-and-selection/): seleção evidente e navegação direcional.
- [Apple — Navigate Apple TV 4K](https://support.apple.com/guide/tv/navigate-apple-tv-4k-atvbe55a4b4e/26/tvos/26): setas, seleção e comportamento previsível de Voltar.
- [Apple — Rearrange apps](https://support.apple.com/guide/tv/rearrange-apps-on-the-home-screen-atvbad14dc6a/26/tvos/26): organização dos favoritos.
- [Apple — apresentação do tvOS 26](https://www.apple.com/newsroom/2025/06/apple-tv-brings-a-beautiful-redesign-and-enhanced-home-entertainment-experience/): hierarquia e contenção visual.
- [LG — ACG](https://webostv.developer.lge.com/develop/guides/acg-guide): permissões e diferenças entre versões do webOS.

## Adaptação

O Casa usa paisagem estática, seis favoritos, três destinos de navegação e controles pequenos, com margem de 90 px na composição 1920×1080. Não utiliza marca Apple nem tenta replicar sua implementação. O wallpaper foi gerado como uma imagem original para este projeto.

Os primeiros testes na própria LG mostraram dois problemas: símbolos Unicode eram substituídos por emojis e o foco escrevia preferências sincronamente a cada movimento. A versão 0.1.1 troca os símbolos por SVG, adia a gravação e evita ler a geometria de todos os botões para navegar pela grade.

As diretrizes da Apple sustentam a direção de interação e composição. A compatibilidade e o desempenho são validados na TV, separadamente.
