require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');

const app = express();
app.use(cors());
app.use(bodyParser.json());

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

db.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Erro fatal ao conectar no banco:', err.message);
    } else {
        console.log('✅ Conectado ao TiDB com Pool de Conexões!');
        connection.release();
    }
});

app.post('/cadastro', async (req, res) => {
    const { nome, email, senha } = req.body;
    
    try {
        const saltRounds = 10; 
        const hash = await bcrypt.hash(senha, saltRounds);

        const sql = 'INSERT INTO usuarios (nome_completo, email, senha) VALUES (?, ?, ?)';
        
        db.query(sql, [nome, email, hash], (err, result) => {
            if (err) {
                console.error("Erro no Banco:", err);
                return res.status(500).json({ error: err.message });
            }
            res.status(201).json({ message: 'Usuário criado com sucesso!' });
        });
    } catch (error) {
        console.error("Erro no Bcrypt:", error);
        res.status(500).json({ error: 'Erro interno ao processar senha.' });
    }
});

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

app.post('/inscricao', (req, res) => {
    const { usuario_id, nome_completo, cpf, idade, genero, endereco, renda_familiar, numero_membros_familia, despesas_mensais, nivel_escolaridade } = req.body;
    
    // --- CORREÇÃO: TRATAMENTO DE DADOS VAZIOS ---
    // Se vier vazio (''), transforma em NULL para o banco não dar erro
    const valIdade = idade === '' ? null : idade;
    const valRenda = renda_familiar === '' ? null : renda_familiar;
    const valMembros = numero_membros_familia === '' ? null : numero_membros_familia;
    const valDespesas = despesas_mensais === '' ? null : despesas_mensais;

    const sql = `INSERT INTO inscricoes (usuario_id, nome_completo, cpf, idade, genero, endereco, renda_familiar, numero_membros_familia, despesas_mensais, nivel_escolaridade) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    // Note que usamos as variáveis val... no lugar das originais
    db.query(sql, [usuario_id, nome_completo, cpf, valIdade, genero, endereco, valRenda, valMembros, valDespesas, nivel_escolaridade], (err, result) => {
        if (err) {
            console.error("Erro SQL:", err); // Ajuda a ver o erro no Log
            if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'CPF já cadastrado.' });
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ message: 'Inscrição realizada!', id: result.insertId });
    });
});

app.get('/admin/inscricoes', (req, res) => {
    const { busca } = req.query;
    
    // MUDANÇA AQUI: Adicionamos o JOIN para pegar o email da tabela usuarios
    // Selecionamos TUDO da inscricoes (i.*) e só o EMAIL do usuario (u.email)
    let sql = `
        SELECT i.*, u.email 
        FROM inscricoes i
        JOIN usuarios u ON i.usuario_id = u.id
    `;
    
    let params = [];

    if (busca) {
        // Ajustamos o filtro para usar o alias 'i' e 'u'
        sql += ' WHERE LOWER(i.nome_completo) LIKE LOWER(?) OR i.cpf LIKE ? OR LOWER(i.status_aprovacao) LIKE LOWER(?)';
        params = [`%${busca}%`, `%${busca}%`, `%${busca}%`];
    }
    
    // Ordenação inteligente (Pendentes primeiro)
    sql += ` ORDER BY 
             CASE 
                WHEN i.status_aprovacao IS NULL OR i.status_aprovacao = '' OR i.status_aprovacao = 'EM ANÁLISE' THEN 0 
                ELSE 1 
             END ASC, 
             i.data_inscricao DESC`;

    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.put('/admin/editar/:id', (req, res) => {
    const { id } = req.params;
    const { nome_completo, cpf, idade, genero, endereco, renda_familiar, numero_membros_familia, despesas_mensais, nivel_escolaridade } = req.body;

    const sql = `UPDATE inscricoes SET 
                 nome_completo = ?, cpf = ?, idade = ?, genero = ?, endereco = ?, 
                 renda_familiar = ?, numero_membros_familia = ?, 
                 despesas_mensais = ?, nivel_escolaridade = ?
                 WHERE id = ?`;

    db.query(sql, [nome_completo, cpf, idade, genero, endereco, renda_familiar, numero_membros_familia, despesas_mensais, nivel_escolaridade, id], (err, result) => {
        if (err) return res.status(500).json({ error: 'Erro ao editar dados.' });
        res.json({ message: 'Dados atualizados com sucesso!' });
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

app.get('/inscricao/usuario/:usuario_id', (req, res) => {
    const { usuario_id } = req.params;
    db.query('SELECT * FROM inscricoes WHERE usuario_id = ?', [usuario_id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length > 0) {
            res.json(results[0]); // Retorna a ficha se existir
        } else {
            res.status(404).json({ message: 'Nenhuma ficha encontrada' });
        }
    });
});

app.put('/inscricao/:id', (req, res) => {
    const { id } = req.params;
    const { nome_completo, cpf, idade, genero, endereco, renda_familiar, numero_membros_familia, despesas_mensais, nivel_escolaridade } = req.body;

    // --- CORREÇÃO: TRATAMENTO DE DADOS VAZIOS ---
    const valIdade = idade === '' ? null : idade;
    const valRenda = renda_familiar === '' ? null : renda_familiar;
    const valMembros = numero_membros_familia === '' ? null : numero_membros_familia;
    const valDespesas = despesas_mensais === '' ? null : despesas_mensais;

    const sql = `UPDATE inscricoes SET 
                 nome_completo = ?, cpf = ?, idade = ?, genero = ?, endereco = ?, 
                 renda_familiar = ?, numero_membros_familia = ?, 
                 despesas_mensais = ?, nivel_escolaridade = ?,
                 status_aprovacao = 'EM ANÁLISE'
                 WHERE id = ?`;

    db.query(sql, [nome_completo, cpf, valIdade, genero, endereco, valRenda, valMembros, valDespesas, nivel_escolaridade, id], (err, result) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Este CPF já está em uso.' });
            return res.status(500).json({ error: 'Erro ao atualizar dados.' });
        }
        res.json({ message: 'Dados atualizados com sucesso!' });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Servidor seguro rodando na porta ${PORT}`); });