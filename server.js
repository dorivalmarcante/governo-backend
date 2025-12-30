require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- MUDANÇA AQUI: USANDO POOL (PISCINA) EM VEZ DE CONNECTION ---
// O Pool reconecta sozinho se cair. É vital para nuvem.
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: { rejectUnauthorized: true }
});

// Teste inicial para ver se o Pool está funcionando
db.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Erro fatal ao conectar no banco:', err.message);
    } else {
        console.log('✅ Conectado ao TiDB com Pool de Conexões!');
        connection.release(); // Devolve a conexão para a piscina
    }
});

// --- ROTA 1: CADASTRO (IGUAL) ---
app.post('/cadastro', async (req, res) => {
    const { nome, email, senha } = req.body;
    
    try {
        const saltRounds = 10; 
        const hash = await bcrypt.hash(senha, saltRounds);

        const sql = 'INSERT INTO usuarios (nome_completo, email, senha) VALUES (?, ?, ?)';
        
        db.query(sql, [nome, email, hash], (err, result) => {
            if (err) {
                console.error("Erro no Banco:", err); // Mostra o erro real no terminal
                return res.status(500).json({ error: err.message });
            }
            res.status(201).json({ message: 'Usuário criado com sucesso!' });
        });
    } catch (error) {
        console.error("Erro no Bcrypt:", error);
        res.status(500).json({ error: 'Erro interno ao processar senha.' });
    }
});

// --- ROTA 2: LOGIN (IGUAL) ---
app.post('/login', (req, res) => {
    const { email, senha } = req.body;
    
    const sql = 'SELECT * FROM usuarios WHERE email = ?';
    db.query(sql, [email], async (err, results) => {
        if (err) {
            console.error("Erro no Login:", err);
            return res.status(500).json({ error: err.message });
        }
        
        if (results.length === 0) {
            return res.status(401).json({ message: 'Email ou senha incorretos' });
        }

        const usuario = results[0];

        try {
            const senhaBate = await bcrypt.compare(senha, usuario.senha);
            if (senhaBate) {
                res.json({ message: 'Login realizado!', user: usuario });
            } else {
                res.status(401).json({ message: 'Email ou senha incorretos' });
            }
        } catch (error) {
             res.status(500).json({ error: 'Erro ao validar senha' });
        }
    });
});

// --- ROTAS PADRÃO ---

app.post('/inscricao', (req, res) => {
    const { usuario_id, nome_completo, cpf, endereco, renda_familiar, numero_membros_familia, despesas_mensais, nivel_escolaridade } = req.body;
    const sql = `INSERT INTO inscricoes (usuario_id, nome_completo, cpf, endereco, renda_familiar, numero_membros_familia, despesas_mensais, nivel_escolaridade) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

    db.query(sql, [usuario_id, nome_completo, cpf, endereco, renda_familiar, numero_membros_familia, despesas_mensais, nivel_escolaridade], (err, result) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'CPF já cadastrado.' });
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ message: 'Inscrição realizada!' });
    });
});

app.get('/admin/inscricoes', (req, res) => {
    db.query('SELECT * FROM inscricoes ORDER BY data_inscricao DESC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.put('/admin/atualizar/:id', (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    db.query('UPDATE inscricoes SET status_aprovacao = ? WHERE id = ?', [status, id], (err, result) => {
        if (err) return res.status(500).json({ error: 'Erro ao atualizar' });
        res.json({ message: `Status alterado para ${status}` });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Servidor seguro rodando na porta ${PORT}`); });