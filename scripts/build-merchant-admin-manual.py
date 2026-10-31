"""Create the combined, secret-free Merchant and Super Admin manual PDF."""
from pathlib import Path
from xml.sax.saxutils import escape
import re
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT=Path(__file__).resolve().parents[1]
pdfmetrics.registerFont(TTFont('Regular','C:/Windows/Fonts/segoeui.ttf'))
pdfmetrics.registerFont(TTFont('Bold','C:/Windows/Fonts/segoeuib.ttf'))
ink=colors.HexColor('#182c28'); green=colors.HexColor('#284d44')
styles={
 'title':ParagraphStyle('title',fontName='Bold',fontSize=25,leading=31,textColor=green,spaceAfter=12),
 'h2':ParagraphStyle('h2',fontName='Bold',fontSize=14,leading=20,textColor=green,spaceBefore=9,spaceAfter=8,keepWithNext=True),
 'body':ParagraphStyle('body',fontName='Regular',fontSize=10,leading=15,textColor=ink,spaceAfter=9),
 'small':ParagraphStyle('small',fontName='Regular',fontSize=8,leading=11,textColor=ink)
}
story=[]
for block in (ROOT/'docs/MERCHANT-ADMIN-MANUAL.md').read_text(encoding='utf-8').split('\n\n'):
    block=block.strip()
    if not block: continue
    lines=block.splitlines(); heading=lines[0]; body='\n'.join(lines[1:]).strip()
    if heading.startswith('# '): story.append(Paragraph(escape(heading[2:]),styles['title']))
    elif heading.startswith('## '): story.append(Paragraph(escape(heading[3:]),styles['h2']))
    else: body=block
    if body:
        clean=re.sub(r'\*\*([^*]+)\*\*',r'\1',body)
        clean=re.sub(r'`([^`]+)`',r'\1',clean)
        clean=re.sub(r'^#{2,3}\s*','',clean,flags=re.MULTILINE)
        story.append(Paragraph(escape(clean).replace('\n','<br/>'),styles['body']))

def footer(canvas,doc):
    canvas.setFillColor(green); canvas.rect(0,835,595.28,7,fill=1,stroke=0)
    canvas.setFont('Regular',8); canvas.setFillColor(ink)
    canvas.drawString(48,28,'Dynamo Pay | Merchant and Super Admin manual | 31 October 2026')
    canvas.drawRightString(547,28,f'Page {doc.page}')

out=ROOT/'output/pdf/Dynamo-Pay-Merchant-and-Admin-Manual.pdf'; out.parent.mkdir(parents=True,exist_ok=True)
SimpleDocTemplate(str(out),pagesize=(595.28,841.89),leftMargin=48,rightMargin=48,topMargin=47,bottomMargin=49,title='Dynamo Pay Merchant and Super Admin Manual',author='Dynamo Pay').build(story,onFirstPage=footer,onLaterPages=footer)
print(out)
