#!/bin/sh
# Sets the truss that scripts/landing-shots.cjs exported (landing/truss.tex) in
# a LaTeX page, as a homework solution would have it, and saves the page as an
# SVG for the landing page's TikZ section: public/landing/latex-page.svg.
set -e
cd "$(dirname "$0")/.."
work=$(mktemp -d)
cp landing/truss.tex "$work/truss.tex"
cat > "$work/page.tex" <<'TEX'
\documentclass[11pt]{article}
\usepackage[paperwidth=13.4cm, paperheight=12.9cm, margin=0.9cm]{geometry}
\usepackage{amsmath, tikz}
\usetikzlibrary{arrows.meta, bending}
\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlength{\parskip}{0.6em}
\begin{document}
\textbf{Problem 3.} The truss in Figure~\ref{fig:truss} carries $F$ and $2F$
at its upper joints. Find the reactions at the supports and the force in
member $BC$.

\begin{figure}[h]
  \centering
  \input{truss.tex}
  \caption{A two-panel truss on a pin at $A$ and a roller at $E$.}
  \label{fig:truss}
\end{figure}

Taking moments about $A$,
\[
  E_y \cdot 2a - F\,\frac{a}{2} - 2F\,\frac{3a}{2} = 0
  \quad\Longrightarrow\quad E_y = \tfrac{7}{4}F .
\]
\end{document}
TEX
(cd "$work" && pdflatex -interaction=nonstopmode page.tex > /dev/null; pdflatex -interaction=nonstopmode page.tex > /dev/null) || { grep -A3 "^!" "$work/page.log" | head -20; exit 1; }
pdftocairo -svg "$work/page.pdf" public/landing/latex-page.svg
pdftocairo -png -r 110 -singlefile "$work/page.pdf" "$work/preview"
cp "$work/preview.png" /tmp/latex-page-preview.png 2>/dev/null || true
echo "wrote public/landing/latex-page.svg"
rm -rf "$work"
